/-
  Elaborate a source file and report what Lean saw, as structured data.

  Goal states come from the InfoTree (the same data Lean's language server
  uses for its goal view), so nothing is parsed from printed text and the
  checked source carries no hidden instrumentation.
-/
import Lean
import Bridge.Protocol

namespace Bridge
open Lean Elab Meta

private def toRange (map : FileMap) (start stop : String.Pos) : Range :=
  let s := map.toPosition start
  let e := map.toPosition stop
  { startLine := s.line, startCol := s.column, endLine := e.line, endCol := e.column }

/-- Print `Natural.add Natural.zero n` as written, not as `Natural.zero.add n`. -/
private def withDisplayOptions (x : MetaM α) : MetaM α :=
  withOptions (fun o => o.setBool `pp.fieldNotation.generalized false) x

private def ppGoal (mvarId : MVarId) : MetaM Goal := withDisplayOptions do
  let decl ← mvarId.getDecl
  withLCtx decl.lctx decl.localInstances do
    let mut hyps := #[]
    for ldecl in decl.lctx do
      if ldecl.isImplementationDetail then continue
      let type ← ppExpr (← instantiateMVars ldecl.type)
      let value? ← match ldecl.value? with
        | some v => pure (some (toString (← ppExpr (← instantiateMVars v))))
        | none => pure none
      hyps := hyps.push {
        id := toString ldecl.fvarId.name
        name := toString ldecl.userName.eraseMacroScopes ++ (if ldecl.userName.hasMacroScopes then "✝" else "")
        inaccessible := ldecl.userName.hasMacroScopes
        type := toString type
        value? }
    let target ← ppExpr (← instantiateMVars decl.type)
    let tag := if decl.userName.isAnonymous then "" else toString decl.userName.eraseMacroScopes
    pure { id := toString mvarId.name, tag, hyps, target := toString target }

private def ppGoals (ctx : ContextInfo) (mctx : MetavarContext) (goals : List MVarId) :
    IO (Array Goal) :=
  { ctx with mctx }.runMetaM {} (goals.toArray.mapM ppGoal)

/-- Wrapper nodes that only group other tactics; the client never maps a step to them. -/
private def structuralKinds : List Name :=
  [``Lean.Parser.Term.byTactic, `by, ``Lean.Parser.Tactic.tacticSeq,
   ``Lean.Parser.Tactic.tacticSeq1Indented, ``Lean.Parser.Tactic.tacticSeqBracketed, nullKind]

/-- Tactic nodes whose syntax came from the source text (not from macro expansion). -/
private def collectTactics (map : FileMap) (trees : Array InfoTree) : IO (Array TacticStep) := do
  let mut out := #[]
  for tree in trees do
    let nodes := tree.foldInfo (init := #[]) fun ctx info acc =>
      match info with
      | .ofTacticInfo ti => acc.push (ctx, ti)
      | _ => acc
    for (ctx, ti) in nodes do
      if structuralKinds.contains ti.stx.getKind then continue
      let some start := ti.stx.getPos? (canonicalOnly := true) | continue
      let some stop := ti.stx.getTailPos? (canonicalOnly := true) | continue
      let before ← ppGoals ctx ti.mctxBefore ti.goalsBefore
      let after ← ppGoals ctx ti.mctxAfter ti.goalsAfter
      out := out.push {
        range := toRange map start stop
        kind := toString ti.stx.getKind
        goalsBefore := before
        goalsAfter := after }
  pure out

private def severityName : MessageSeverity → String
  | .error => "error"
  | .warning => "warning"
  | .information => "info"

/-- The source is elaborated in module mode, so its declarations are private. -/
private def resolveDecl (env : Environment) (name : Name) : Option Name :=
  if env.contains name then some name
  else
    let priv := mkPrivateName env name
    if env.contains priv then some priv else none

/--
  Axioms that library declarations really are. Imports are loaded at the
  `exported` level, where library theorems arrive without their proofs and
  look like axioms, so `collectAxioms` cannot tell them apart. Instead we walk
  only the declarations made in the checked source, and report a library
  constant only when it is one of these.
-/
private def libraryAxioms : List Name :=
  [``propext, ``Classical.choice, ``Quot.sound, ``sorryAx,
   ``Lean.ofReduceBool, ``Lean.ofReduceNat, ``Lean.trustCompiler]

private partial def axiomsOf (env : Environment) (name : Name) : IO (Array String) := do
  let rec go (n : Name) (st : NameSet × Array Name) : NameSet × Array Name := Id.run do
    let (seen, axs) := st
    if seen.contains n then return st
    let seen := seen.insert n
    if (env.getModuleIdxFor? n).isSome then
      return (seen, if libraryAxioms.contains n then axs.push n else axs)
    match env.find? n with
    | some (.axiomInfo _) => return (seen, axs.push n)
    | some info =>
      let refs := info.type.getUsedConstants ++ (info.value?.map (·.getUsedConstants)).getD #[]
      refs.foldl (fun st r => go r st) (seen, axs)
    | none => return (seen, axs)
  let (_, axs) := go name ({}, #[])
  pure (axs.map fun n => toString ((privateToUserName? n).getD n))

/--
  Imported environments, keyed by the text of the file's header. Importing
  `Init` costs about a second; every request after the first reuses it.
  Environments are immutable, so sharing one between requests is safe.
-/
initialize headerCache : IO.Ref (Option (String × Environment)) ← IO.mkRef none

private def importHeader (inputCtx : Parser.InputContext) (header : TSyntax ``Parser.Module.header)
    (messages : MessageLog) : IO (Environment × MessageLog) := do
  let key := toString header.raw.prettyPrint
  if let some (k, env) ← headerCache.get then
    if k == key then return (env, messages)
  -- Import at the `exported` level (as a `module` file would) so the runtime
  -- only needs each library module's `.olean` and `.ir`, not the private and
  -- server parts. This keeps the browser download small. Declarations made in
  -- the checked source then get private names, which `resolveDecl` handles.
  let (env, messages') ← processHeaderCore (header.raw.getPos?.getD 0) (headerToImports header)
    (isModule := true) {} messages inputCtx (mainModule := `Leandoku)
  if !messages'.hasErrors then headerCache.set (some (key, env))
  return (env, messages')

def check (req : CheckRequest) : IO CheckResponse := do
  let inputCtx := Parser.mkInputContext req.source "<proof>"
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, headerMessages) ← importHeader inputCtx header messages
  -- Elaboration starts a fresh message log, so header errors (such as a
  -- library file that fails to load) must be carried over explicitly.
  let messages : MessageLog := {}
  -- Elaborate proofs synchronously so the final environment holds every
  -- declaration (asynchronous proof elaboration can leave theorems pending).
  let opts := Elab.async.set {} false
  let cmdState := { Command.mkState env messages opts with infoState.enabled := true }
  let s ← IO.processCommands inputCtx parserState cmdState
  let cmd := s.commandState
  let map := inputCtx.fileMap
  let mut msgs := #[]
  for m in headerMessages.toList ++ cmd.messages.toList do
    let stop := m.endPos.getD m.pos
    msgs := msgs.push {
      severity := severityName m.severity
      range := {
        startLine := m.pos.line, startCol := m.pos.column
        endLine := stop.line, endCol := stop.column }
      text := (← m.data.toString).trimRight }
  let tactics ← collectTactics map cmd.infoState.trees.toArray
  let completion? ← match req.theoremName? with
    | none => pure none
    | some n =>
      let name := n.toName
      -- In a `module` file the environment may be in exporting mode; look at
      -- everything the file declared, private parts included.
      let env := cmd.env.setExporting false
      if let some decl := resolveDecl env name then
        pure (some { theoremName := n, exists_ := true, axioms := ← axiomsOf env decl })
      else
        pure (some { theoremName := n, exists_ := false, axioms := #[] })
  pure { requestId := req.requestId, messages := msgs, tactics, completion? }

end Bridge
