import type { SlotValue } from '../catalog/types';
import type { Branch, BranchId, InsertPoint, ProofDocument, Step, StepId } from './types';

export type IdSource = () => string;

let counter = 0;
/** Default id source; tests pass their own for stable snapshots. */
export const freshId: IdSource = () => `n${(++counter).toString(36)}${Date.now().toString(36).slice(-4)}`;

export const ROOT_BRANCH: BranchId = 'root';

export function emptyDocument(): ProofDocument {
  return { revision: 0, root: { id: ROOT_BRANCH, tag: '', names: [], steps: [] } };
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
  return mapBranch(doc, at.branch, (b) => {
    if (at.index < 0 || at.index > b.steps.length) throw new EditError(`index ${at.index} out of range`);
    const before = b.steps[at.index - 1];
    if (before?.branches) throw new EditError('cannot add a step after a step that split the goal');
    const steps = [...b.steps];
    steps.splice(at.index, 0, step);
    return { ...b, steps };
  });
}

/** Remove a step (and any branches under it). Later steps move up; no gap is left. */
export function deleteStep(doc: ProofDocument, id: StepId): ProofDocument {
  const loc = locateStep(doc, id);
  if (!loc) throw new EditError(`no step ${id}`);
  return mapBranch(doc, loc.branch.id, (b) => ({ ...b, steps: b.steps.filter((s) => s.id !== id) }));
}

/** Change a step's tactic or arguments in place, keeping its id and branches. */
export function updateStep(
  doc: ProofDocument,
  id: StepId,
  change: { tactic?: string; args?: Record<string, SlotValue> },
): ProofDocument {
  return mapStep(doc, id, (s) => ({
    ...s,
    tactic: change.tactic ?? s.tactic,
    args: change.args ?? s.args,
    ...(change.tactic && change.tactic !== s.tactic ? { branches: undefined } : {}),
  }));
}

/**
 * Give a step one branch per goal it left, matching existing branches by tag
 * then position so work already done in a branch is kept. Passing an empty
 * list removes the branches.
 */
export function setBranches(
  doc: ProofDocument,
  id: StepId,
  goals: readonly { tag: string; names?: readonly string[] }[],
  ids: IdSource = freshId,
): ProofDocument {
  const loc = locateStep(doc, id);
  if (!loc) throw new EditError(`no step ${id}`);
  if (goals.length > 0 && loc.index !== loc.branch.steps.length - 1) {
    throw new EditError('only the last step of a sequence can split into branches');
  }
  return mapStep(doc, id, (s) => {
    if (goals.length === 0) return { ...s, branches: undefined };
    const old = [...(s.branches ?? [])];
    const branches = goals.map((g, i): Branch => {
      const reuse = g.tag ? old.find((b) => b.tag === g.tag) : old[i];
      if (reuse) return { ...reuse, tag: g.tag, names: g.names ?? reuse.names };
      return { id: ids(), tag: g.tag, names: g.names ?? [], steps: [] };
    });
    return { ...s, branches };
  });
}

export function setBranchNames(doc: ProofDocument, branch: BranchId, names: readonly string[]): ProofDocument {
  return mapBranch(doc, branch, (b) => ({ ...b, names }));
}

export interface StepLocation {
  branch: Branch;
  index: number;
  step: Step;
}

export function locateStep(doc: ProofDocument, id: StepId): StepLocation | undefined {
  let found: StepLocation | undefined;
  walk(doc.root, (branch) => {
    const index = branch.steps.findIndex((s) => s.id === id);
    if (index >= 0) found = { branch, index, step: branch.steps[index]! };
  });
  return found;
}

export function findBranch(doc: ProofDocument, id: BranchId): Branch | undefined {
  let found: Branch | undefined;
  walk(doc.root, (b) => {
    if (b.id === id) found = b;
  });
  return found;
}

/** Visit every branch, parents before children. */
export function walk(branch: Branch, visit: (b: Branch) => void): void {
  visit(branch);
  for (const s of branch.steps) for (const child of s.branches ?? []) walk(child, visit);
}

function mapBranch(doc: ProofDocument, id: BranchId, f: (b: Branch) => Branch): ProofDocument {
  let hit = false;
  const go = (b: Branch): Branch => {
    if (b.id === id) {
      hit = true;
      return f(b);
    }
    let changed = false;
    const steps = b.steps.map((s) => {
      if (!s.branches) return s;
      const branches = s.branches.map(go);
      if (branches.some((nb, i) => nb !== s.branches![i])) {
        changed = true;
        return { ...s, branches };
      }
      return s;
    });
    return changed ? { ...b, steps } : b;
  };
  const root = go(doc.root);
  if (!hit) throw new EditError(`no branch ${id}`);
  return { revision: doc.revision + 1, root };
}

function mapStep(doc: ProofDocument, id: StepId, f: (s: Step) => Step): ProofDocument {
  const loc = locateStep(doc, id);
  if (!loc) throw new EditError(`no step ${id}`);
  return mapBranch(doc, loc.branch.id, (b) => ({
    ...b,
    steps: b.steps.map((s) => (s.id === id ? f(s) : s)),
  }));
}
