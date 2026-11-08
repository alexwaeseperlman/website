import type { SlotValue } from '../catalog/types';
import type { LevelPolicy } from '../policy/policy';

/** A builder action, as a player would tap it. Reference solutions are written in these. */
export interface ScriptStep {
  tactic: string;
  args?: Record<string, SlotValue>;
}

export interface Level {
  /** Stable across course revisions; never reuse an id for a changed statement. */
  id: string;
  chapter: string;
  title: string;
  /** Bumped whenever the statement or the allowed knowledge changes. */
  revision: number;
  prerequisites: string[];
  intro: string;
  theoremName: string;
  /** The statement, up to and including `:= by`. */
  header: string;
  policy: LevelPolicy;
  /**
   * A solution using only builder actions the policy allows, as one tactic
   * sequence (the order Lean works through its goals). Replayed in CI.
   */
  solution: ScriptStep[];
  /** Lean library facts offered in this level's pickers, beyond earlier levels. */
  library?: LibraryFact[];
}

export interface LibraryFact {
  name: string;
  /** How the picker shows it, e.g. `(h : a = b) : b = a`. */
  statement: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** One or two sentences on the map. */
  blurb: string;
  /**
   * Lean this chapter's levels need beyond the course prelude. It is only
   * compiled for levels that use it: every check re-elaborates the whole
   * source, and on iPhone the stack is tight.
   */
  prelude?: string;
  /** Chapters whose preludes this one builds on. */
  needs?: string[];
}

/** A paragraph, a Lean snippet shown as-is, or an aside. */
export type TutorialBlock = { text: string } | { code: string } | { aside: string };

/**
 * A short read placed before a level that needs a new idea. It never asks
 * for a proof; the level after it is where the idea gets used.
 */
export interface Tutorial {
  id: string;
  /** The level this leads into. The tutorial opens once that level does. */
  before: string;
  title: string;
  blocks: TutorialBlock[];
  /** Definitions from the course to show in full under the text. */
  definitions?: string[];
}

export interface Definition {
  name: string;
  /** The Lean source, exactly as it appears in the prelude. */
  source: string;
}

export interface Course {
  id: string;
  title: string;
  /** Lean shared by every level; chapters add their own on top. */
  prelude: string;
  /** Definitions the player can read and unfold. */
  definitions: Definition[];
  chapters: Chapter[];
  /** In play order; each level's chapter must appear in `chapters`. */
  levels: Level[];
  tutorials: Tutorial[];
}
