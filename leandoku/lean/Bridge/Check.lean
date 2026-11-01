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

private def axiomsOf (env : Environment) (name : Name) : IO (Array String) := do
  let ctx : Core.Context := { fileName := "<proof>", fileMap := default }
  let (axs, _) ← (collectAxioms name : CoreM _).toIO ctx { env }
  pure (axs.map toString)

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
  let (env, messages') ← processHeader header {} messages inputCtx
  if !messages'.hasErrors then headerCache.set (some (key, env))
  return (env, messages')

def check (req : CheckRequest) : IO CheckResponse := do
  let inputCtx := Parser.mkInputContext req.source "<proof>"
  let (header, parserState, messages) ← Parser.parseHeader inputCtx
  let (env, messages) ← importHeader inputCtx header messages
  let cmdState := { Command.mkState env messages {} with infoState.enabled := true }
  let s ← IO.processCommands inputCtx parserState cmdState
  let cmd := s.commandState
  let map := inputCtx.fileMap
  let mut msgs := #[]
  for m in cmd.messages.toList do
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
      if cmd.env.contains name then
        pure (some { theoremName := n, exists_ := true, axioms := ← axiomsOf cmd.env name })
      else
        pure (some { theoremName := n, exists_ := false, axioms := #[] })
  pure { requestId := req.requestId, messages := msgs, tactics, completion? }

end Bridge
