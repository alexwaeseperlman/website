import { describe, expect, it } from 'vitest';
import { EditError, deleteStep, emptyDocument, indexOfStep, insertStep, makeStep, updateStep } from '../src/core/document/edit';
import { History } from '../src/core/document/history';
import { counterIds } from './helpers';

describe('proof document', () => {
  it('collapses later steps upward when a step is deleted', () => {
    const ids = counterIds();
    const a = makeStep('intro', {}, ids);
    const b = makeStep('rfl', {}, ids);
    let doc = insertStep(emptyDocument(), 0, a);
    doc = insertStep(doc, 1, b);
    doc = deleteStep(doc, a.id);
    expect(doc.steps.map((s) => s.id)).toEqual([b.id]);
    expect(indexOfStep(doc, b.id)).toBe(0);
  });

  it('inserts at the selected boundary', () => {
    const ids = counterIds();
    let doc = insertStep(emptyDocument(), 0, makeStep('intro', {}, ids));
    doc = insertStep(doc, 1, makeStep('rfl', {}, ids));
    doc = insertStep(doc, 1, makeStep('assumption', {}, ids));
    expect(doc.steps.map((s) => s.tactic)).toEqual(['intro', 'assumption', 'rfl']);
  });

  it('adds steps after a tactic that leaves several goals, as plain Lean does', () => {
    const ids = counterIds();
    let doc = insertStep(emptyDocument(), 0, makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids));
    doc = insertStep(doc, 1, makeStep('rfl', {}, ids));
    expect(doc.steps.map((s) => s.tactic)).toEqual(['induction', 'rfl']);
  });

  it('rejects an insertion point outside the proof', () => {
    expect(() => insertStep(emptyDocument(), 1, makeStep('rfl', {}, counterIds()))).toThrow(EditError);
  });

  it('bumps the revision on every edit', () => {
    const doc0 = emptyDocument();
    const doc1 = insertStep(doc0, 0, makeStep('rfl', {}, counterIds()));
    expect(doc1.revision).toBe(doc0.revision + 1);
    const doc2 = updateStep(doc1, doc1.steps[0]!.id, { tactic: 'assumption' });
    expect(doc2.revision).toBe(doc1.revision + 1);
    expect(doc2.steps[0]!.tactic).toBe('assumption');
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
