/**
 * The tactic catalog describes tactics as data. The composer UI and the
 * serializer are generic over these descriptions, so adding a tactic means
 * adding an entry here, never a new branch in page code.
 */

/** What kind of value a slot takes, which decides the picker the UI shows. */
export type SlotKind =
  /** A Lean term: a fact, a local, or a staged application. */
  | 'term'
  /** One local hypothesis or variable in the selected goal. */
  | 'local'
  /** Fresh names to bind (intro, obtain). */
  | 'names'
  /** Rewrite rules: terms with a direction. */
  | 'rules'
  /** The goal, or a hypothesis, to act on. */
  | 'location'
  /** Definitions to unfold. */
  | 'definitions'
  /** Free Lean syntax, for tactics without a dedicated widget. */
  | 'raw';

export interface SlotSpec {
  id: string;
  kind: SlotKind;
  label: string;
  /** An optional slot may be left empty and still serialize. */
  optional?: boolean;
}

export interface RewriteRule {
  term: string;
  /** `true` rewrites right-to-left (`← h`). */
  reverse: boolean;
}

export type SlotValue =
  | { kind: 'term'; text: string }
  | { kind: 'local'; name: string }
  | { kind: 'names'; names: string[] }
  | { kind: 'rules'; rules: RewriteRule[] }
  | { kind: 'location'; hyp: string | null }
  | { kind: 'definitions'; names: string[] }
  | { kind: 'raw'; text: string };

/**
 * How the goals a tactic leaves behind are laid out in the generated Lean.
 * - `bullets`: one `·` block per goal (constructor, apply, ...).
 * - `alternatives`: `with | tag names => ...` arms (induction, cases), which
 *   is also how the player names the variables each case introduces.
 */
export type BranchStyle = 'bullets' | 'alternatives';

export type TacticCategory = 'finish' | 'intro' | 'rewrite' | 'split' | 'apply' | 'simplify' | 'other';

export interface TacticSpec {
  id: string;
  label: string;
  category: TacticCategory;
  help: string;
  slots: SlotSpec[];
  /**
   * Lean source with `{slotId}` placeholders. A placeholder may carry text
   * that is emitted only when the slot has a value: `{ at |location}` emits
   * ` at h` for a hypothesis and nothing for the goal.
   */
  template: string;
  branchStyle: BranchStyle;
}
