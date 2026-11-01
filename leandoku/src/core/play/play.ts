import type { TacticCatalog } from '../catalog/registry';
import { findBranch, setBranches, walk, type IdSource } from '../document/edit';
import type { BranchId, InsertPoint, ProofDocument, Step } from '../document/types';
import type { Evaluation } from '../evaluate/evaluate';
import type { Goal } from '../../engine/protocol';

/**
 * Give a split its branches, using only the goals Lean reported. A step that
 * already has branches is left alone: once its cases are written out, Lean
 * reports the cases through the branches themselves (an `induction ... with`
 * step that handles every case leaves no goals behind). Returns the same
 * document when nothing changes, so callers can tell whether to check again.
 */
export function autoBranch(doc: ProofDocument, ev: Evaluation, catalog: TacticCatalog, ids?: IdSource): ProofDocument {
  let next = doc;
  walk(doc.root, (branch) => {
    const last = branch.steps.at(-1);
    if (!last || last.branches?.length) return;
    const r = ev.steps.get(last.id);
    if (!r || r.status !== 'ok' || !r.goalsAfter || r.goalsAfter.length <= 1) return;
    const alternatives = catalog.get(last.tactic)?.branchStyle === 'alternatives';
    next = setBranches(
      next,
      last.id,
      r.goalsAfter.map((g) => ({ tag: g.tag, names: alternatives ? defaultCaseNames(last, g) : [] })),
      ids,
    );
  });
  return next;
}

/**
 * Names for the variables a case introduces. Lean shows them as `n✝`, which
 * the player cannot type; the `with` arm gives them real names.
 */
export function defaultCaseNames(step: Step, goal: Goal): string[] {
  const taken = new Set(goal.hyps.filter((h) => !h.inaccessible).map((h) => h.name));
  const target = step.args['target'];
  const varName = target?.kind === 'local' ? target.name : undefined;
  const out: string[] = [];
  for (const h of goal.hyps) {
    if (!h.inaccessible) continue;
    const raw = h.name.replace(/✝.*$/, '');
    // Lean calls an induction hypothesis `a_ih✝`; the new variable `a✝`.
    let base = /(^|_)ih$/.test(raw) ? 'ih' : step.tactic === 'induction' && varName ? varName : raw || 'x';
    if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(base)) base = 'x';
    let name = base;
    for (let i = 1; taken.has(name); i++) name = `${base}${i}`;
    taken.add(name);
    out.push(name);
  }
  return out;
}

export interface Checkpoint {
  /** Goals at this point, as Lean reported them; null when Lean never got here. */
  goals: Goal[] | null;
  /** The step right after the checkpoint, if any. */
  next: Step | null;
  /** True when the sequence ends in a split, so new steps go inside a branch. */
  split: boolean;
}

/** The proof state at an insertion point: before step `index`, or after the last one. */
export function checkpointAt(doc: ProofDocument, ev: Evaluation | null, at: InsertPoint): Checkpoint {
  const branch = findBranch(doc, at.branch);
  if (!branch) return { goals: null, next: null, split: false };
  const next = branch.steps[at.index] ?? null;
  if (!ev) return { goals: null, next, split: false };
  if (next) {
    const r = ev.steps.get(next.id);
    return { goals: r && r.status !== 'blocked' ? r.goalsBefore : null, next, split: false };
  }
  const last = branch.steps.at(-1);
  if (!last) {
    const g = ev.branches.get(branch.id)?.goal;
    return { goals: g ? [g] : null, next: null, split: false };
  }
  const r = ev.steps.get(last.id);
  return { goals: r?.goalsAfter ?? null, next: null, split: Boolean(last.branches?.length) };
}

/** Clamp a selection that an edit may have invalidated. */
export function validSelection(doc: ProofDocument, at: InsertPoint): InsertPoint {
  const b = findBranch(doc, at.branch);
  if (!b) return { branch: doc.root.id, index: doc.root.steps.length };
  return { branch: b.id, index: Math.min(at.index, b.steps.length) };
}

/** The first place with work left: an empty branch, or the end of an unfinished one. */
export function firstOpenPoint(doc: ProofDocument, ev: Evaluation | null): InsertPoint {
  let found: InsertPoint | null = null;
  walk(doc.root, (b) => {
    if (found) return;
    const last = b.steps.at(-1);
    if (last?.branches?.length) return;
    const cp = checkpointAt(doc, ev, { branch: b.id, index: b.steps.length });
    if (!last || (cp.goals && cp.goals.length > 0)) found = { branch: b.id, index: b.steps.length };
  });
  return found ?? { branch: doc.root.id, index: doc.root.steps.length };
}

/** A goal still to prove, and where to add the step that works on it. */
export interface OpenGoal {
  at: InsertPoint;
  goal: Goal;
}

/**
 * Every goal still open, in the order Lean would have you prove them: the
 * goals at the end of each unfinished branch, in document order. Together
 * they are Lean's goal list, even though each case of a split is written
 * in its own block.
 */
export function openGoals(doc: ProofDocument, ev: Evaluation | null): OpenGoal[] {
  const out: OpenGoal[] = [];
  walk(doc.root, (b) => {
    if (b.steps.at(-1)?.branches?.length) return;
    const at = { branch: b.id, index: b.steps.length };
    for (const goal of checkpointAt(doc, ev, at).goals ?? []) out.push({ at, goal });
  });
  return out;
}

/**
 * Names to offer for `rename_i` at a point whose goal has unnamed (✝)
 * hypotheses: after `induction n`, the new number is named after n and the
 * hypothesis `ih`. Empty when everything already has a name.
 */
export function renameSuggestion(doc: ProofDocument, at: InsertPoint, goal: Goal | null): string[] {
  if (!goal?.hyps.some((h) => h.inaccessible)) return [];
  let parent: Step | undefined;
  walk(doc.root, (b) => {
    for (const s of b.steps) if (s.branches?.some((c) => c.id === at.branch)) parent = s;
  });
  return defaultCaseNames(parent ?? ({ tactic: '', args: {} } as unknown as Step), goal);
}

export type { BranchId };
