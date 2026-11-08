import type { SlotValue } from '../catalog/types';

export type StepId = string;

/** One tactic the player committed. Its id survives edits elsewhere in the proof. */
export interface Step {
  id: StepId;
  /** Catalog id, e.g. `rw` or `induction`. */
  tactic: string;
  args: Readonly<Record<string, SlotValue>>;
}

/**
 * The player's proof: a plain tactic sequence, one tactic per line, exactly
 * as it is written in the Lean source. A tactic that leaves several goals
 * (`induction`, `constructor`) needs nothing special; the steps after it
 * work on Lean's goal list in order, as they would in any Lean file.
 */
export interface ProofDocument {
  /** Increments on every edit; responses for older revisions are discarded. */
  revision: number;
  steps: readonly Step[];
}

/** Where a new step goes: before step `index`, or at the end when `index` is the length. */
export type InsertPoint = number;
