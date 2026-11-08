import type { InsertPoint, ProofDocument, Step } from '../document/types';
import type { Evaluation } from '../evaluate/evaluate';
import type { Goal } from '../../engine/protocol';

export interface Checkpoint {
  /** Lean's goal list at this point, main goal first; null when Lean never got here. */
  goals: Goal[] | null;
  /** The step right after the checkpoint, if any. */
  next: Step | null;
}

/** The proof state at an insertion point: before step `at`, or after the last one. */
export function checkpointAt(doc: ProofDocument, ev: Evaluation | null, at: InsertPoint): Checkpoint {
  const next = doc.steps[at] ?? null;
  if (!ev) return { goals: null, next };
  if (next) {
    const r = ev.steps.get(next.id);
    return { goals: r && r.status !== 'blocked' ? r.goalsBefore : null, next };
  }
  const last = doc.steps.at(-1);
  if (!last) return { goals: ev.placeholderGoals, next: null };
  return { goals: ev.steps.get(last.id)?.goalsAfter ?? null, next: null };
}

/**
 * The names Lean gives the hypotheses it hides (`n✝`, `ih✝`), without the
 * ✝ the bridge appends, as a starting point for `rename_i`. Empty when the
 * goal hides nothing.
 */
export function hiddenNames(goal: Goal | null): string[] {
  return (goal?.hyps ?? []).filter((h) => h.inaccessible).map((h) => h.name.replace(/✝$/, ''));
}
