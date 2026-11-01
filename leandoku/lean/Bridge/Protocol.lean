/-
  Wire format between the Leandoku client and the Lean bridge.

  Positions use Lean's convention: `line` is 1-based, `col` counts Unicode
  code points from 0. The TypeScript mirror lives in `src/engine/protocol.ts`;
  bump `protocolVersion` in both places when either side changes shape.
-/
import Lean

namespace Bridge
open Lean

def protocolVersion : Nat := 1

structure Range where
  startLine : Nat
  startCol : Nat
  endLine : Nat
  endCol : Nat
  deriving ToJson, FromJson, BEq, Repr

structure Hyp where
  /-- Stable within one response: Lean's `FVarId`. -/
  id : String
  /-- The name as Lean prints it, e.g. `n` or `a✝`. -/
  name : String
  /-- True when the name cannot be typed back into a tactic (`a✝`). -/
  inaccessible : Bool
  type : String
  /-- Present for `let`-bound locals. -/
  value? : Option String := none
  deriving ToJson, FromJson

structure Goal where
  /-- Stable within one response: Lean's `MVarId`. -/
  id : String
  /-- Case tag such as `zero` or `succ`; empty when anonymous. -/
  tag : String
  hyps : Array Hyp
  target : String
  deriving ToJson, FromJson

/-- One tactic Lean actually ran, with the goals it saw and left behind. -/
structure TacticStep where
  range : Range
  /-- Syntax node kind, e.g. `Lean.Parser.Tactic.tacticRfl`. -/
  kind : String
  goalsBefore : Array Goal
  goalsAfter : Array Goal
  deriving ToJson, FromJson

structure Message where
  severity : String
  range : Range
  text : String
  deriving ToJson, FromJson

structure CheckRequest where
  version : Nat
  requestId : String
  source : String
  /-- Declaration whose axioms are reported for completion checking. -/
  theoremName? : Option String := none
  deriving ToJson, FromJson

structure Completion where
  theoremName : String
  /-- Declared in the environment after elaboration. -/
  exists_ : Bool
  axioms : Array String
  deriving ToJson, FromJson

structure CheckResponse where
  version : Nat := protocolVersion
  requestId : String
  messages : Array Message
  tactics : Array TacticStep
  completion? : Option Completion := none
  deriving ToJson, FromJson

end Bridge
