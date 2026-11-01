import { describe, expect, it } from 'vitest';
import {
  EditError,
  ROOT_BRANCH,
  deleteStep,
  emptyDocument,
  findBranch,
  insertStep,
  locateStep,
  makeStep,
  setBranches,
  updateStep,
} from '../src/core/document/edit';
import { History } from '../src/core/document/history';
import { counterIds } from './helpers';

describe('proof document', () => {
  it('collapses later steps upward when a step is deleted', () => {
    const ids = counterIds();
    const a = makeStep('intro', {}, ids);
    const b = makeStep('rfl', {}, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, a);
    doc = insertStep(doc, { branch: ROOT_BRANCH, index: 1 }, b);
    doc = deleteStep(doc, a.id);
    expect(doc.root.steps.map((s) => s.id)).toEqual([b.id]);
    expect(locateStep(doc, b.id)?.index).toBe(0);
  });

  it('inserts at the selected boundary', () => {
    const ids = counterIds();
    const a = makeStep('intro', {}, ids);
    const b = makeStep('rfl', {}, ids);
    const c = makeStep('assumption', {}, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, a);
    doc = insertStep(doc, { branch: ROOT_BRANCH, index: 1 }, b);
    doc = insertStep(doc, { branch: ROOT_BRANCH, index: 1 }, c);
    expect(doc.root.steps.map((s) => s.tactic)).toEqual(['intro', 'assumption', 'rfl']);
  });

  it('bumps the revision on every edit', () => {
    const doc0 = emptyDocument();
    const doc1 = insertStep(doc0, { branch: ROOT_BRANCH, index: 0 }, makeStep('rfl', {}, counterIds()));
    expect(doc1.revision).toBe(doc0.revision + 1);
  });

  it('keeps work inside branches when Lean reports the same cases again', () => {
    const ids = counterIds();
    const ind = makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, ind);
    doc = setBranches(doc, ind.id, [{ tag: 'zero' }, { tag: 'succ', names: ['m', 'ih'] }], ids);
    const succ = locateStep(doc, ind.id)!.step.branches![1]!;
    doc = insertStep(doc, { branch: succ.id, index: 0 }, makeStep('rfl', {}, ids));
    doc = setBranches(doc, ind.id, [{ tag: 'zero' }, { tag: 'succ' }], ids);
    const after = locateStep(doc, ind.id)!.step.branches!;
    expect(after[1]!.id).toBe(succ.id);
    expect(after[1]!.names).toEqual(['m', 'ih']);
    expect(findBranch(doc, succ.id)!.steps).toHaveLength(1);
  });

  it('does not allow steps after a step that split the goal', () => {
    const ids = counterIds();
    const c = makeStep('constructor', {}, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, c);
    doc = setBranches(doc, c.id, [{ tag: 'left' }, { tag: 'right' }], ids);
    expect(() => insertStep(doc, { branch: ROOT_BRANCH, index: 1 }, makeStep('rfl', {}, ids))).toThrow(EditError);
  });

  it('drops branches when the tactic changes', () => {
    const ids = counterIds();
    const c = makeStep('constructor', {}, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, c);
    doc = setBranches(doc, c.id, [{ tag: 'left' }, { tag: 'right' }], ids);
    doc = updateStep(doc, c.id, { tactic: 'rfl' });
    expect(locateStep(doc, c.id)!.step.branches).toBeUndefined();
  });

  it('undoes and redoes whole snapshots', () => {
    const h = new History(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBe(2);
    h.push(9);
    expect(h.canRedo).toBe(false);
  });
});
