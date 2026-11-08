import type { SlotValue } from '../catalog/types';
import type { InsertPoint, ProofDocument, Step, StepId } from './types';

export type IdSource = () => string;

let counter = 0;
/** Default id source; tests pass their own for stable snapshots. */
export const freshId: IdSource = () => `n${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`;

export function emptyDocument(): ProofDocument {
  return { revision: 0, steps: [] };
}

export function makeStep(
  tactic: string,
  args: Record<string, SlotValue> = {},
  ids: IdSource = freshId,
): Step {
  return { id: ids(), tactic, args };
}

export class EditError extends Error {}

export function insertStep(doc: ProofDocument, at: InsertPoint, step: Step): ProofDocument {
  if (at < 0 || at > doc.steps.length) throw new EditError(`index ${at} out of range`);
  const steps = [...doc.steps];
  steps.splice(at, 0, step);
  return { revision: doc.revision + 1, steps };
}

/** Remove a step. Later steps move up; no gap is left. */
export function deleteStep(doc: ProofDocument, id: StepId): ProofDocument {
  if (!doc.steps.some((s) => s.id === id)) throw new EditError(`no step ${id}`);
  return { revision: doc.revision + 1, steps: doc.steps.filter((s) => s.id !== id) };
}

/** Change a step's tactic or arguments in place, keeping its id. */
export function updateStep(
  doc: ProofDocument,
  id: StepId,
  change: { tactic?: string; args?: Record<string, SlotValue> },
): ProofDocument {
  if (!doc.steps.some((s) => s.id === id)) throw new EditError(`no step ${id}`);
  return {
    revision: doc.revision + 1,
    steps: doc.steps.map((s) => (s.id === id ? { ...s, tactic: change.tactic ?? s.tactic, args: change.args ?? s.args } : s)),
  };
}

export function indexOfStep(doc: ProofDocument, id: StepId): number {
  return doc.steps.findIndex((s) => s.id === id);
}

/** Clamp an insertion point that an edit may have invalidated. */
export function validInsertPoint(doc: ProofDocument, at: InsertPoint): InsertPoint {
  return Math.max(0, Math.min(at, doc.steps.length));
}
