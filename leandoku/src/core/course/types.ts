import type { SlotValue } from '../catalog/types';
import type { LevelPolicy } from '../policy/policy';

/** A builder action, as a player would tap it. Reference solutions are written in these. */
export interface ScriptStep {
  tactic: string;
  args?: Record<string, SlotValue>;
  /** Variable names for each case, when this step splits into `with` arms. */
  cases?: Record<string, string[]>;
  /** Steps for each branch this step opens, in Lean's goal order. */
  branches?: ScriptStep[][];
}

export interface Level {
  /** Stable across course revisions; never reuse an id for a changed statement. */
  id: string;
  title: string;
  /** Bumped whenever the statement or the allowed knowledge changes. */
  revision: number;
  prerequisites: string[];
  intro: string;
  theoremName: string;
  /** The statement, up to and including `:= by`. */
  header: string;
  policy: LevelPolicy;
  /** A solution using only builder actions the policy allows. Replayed in CI. */
  solution: ScriptStep[];
}

export interface Definition {
  name: string;
  /** The Lean source, exactly as it appears in the prelude. */
  source: string;
}

export interface Course {
  id: string;
  title: string;
  /** Lean definitions shared by every level. */
  prelude: string;
  /** Definitions the player can read and unfold. */
  definitions: Definition[];
  levels: Level[];
}
