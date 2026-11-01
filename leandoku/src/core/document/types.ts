import type { SlotValue } from '../catalog/types';

export type StepId = string;
export type BranchId = string;

/** One tactic the player committed. Its id survives edits elsewhere in the proof. */
export interface Step {
  id: StepId;
  /** Catalog id, e.g. `rw` or `induction`. */
  tactic: string;
  args: Readonly<Record<string, SlotValue>>;
  /**
   * Present once the tactic has split the goal. Only the last step of a
   * sequence may have branches; each branch proves one of the goals it left.
   */
  branches?: readonly Branch[];
}

export interface Branch {
  id: BranchId;
  /** Lean's case tag for the goal (`zero`, `succ`, `left`); empty if anonymous. */
  tag: string;
  /** Names for the variables the case introduces (`with | succ m ih`). */
  names: readonly string[];
  steps: readonly Step[];
}

/** The player's proof as structure; Lean source is generated from it. */
export interface ProofDocument {
  /** Increments on every edit; responses for older revisions are discarded. */
  revision: number;
  root: Branch;
}

/** Where a new step goes: before `index` in the sequence of `branch`. */
export interface InsertPoint {
  branch: BranchId;
  index: number;
}
