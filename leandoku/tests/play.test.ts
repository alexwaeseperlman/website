import { describe, expect, it } from 'vitest';
import { emptyDocument, insertStep, makeStep } from '../src/core/document/edit';
import type { Evaluation } from '../src/core/evaluate/evaluate';
import { checkpointAt, hiddenNames } from '../src/core/play/play';
import type { Goal } from '../src/engine/protocol';

const goal = (tag: string, hyps: Goal['hyps'] = []): Goal => ({ id: tag, tag, target: `P ${tag}`, hyps });

describe('checkpoints', () => {
  it("shows Lean's whole goal list after a step that leaves several goals", () => {
    const s = makeStep('induction', { target: { kind: 'local', name: 'n' } });
    const doc = insertStep(emptyDocument(), 0, s);
    const ev = {
      status: 'incomplete',
      steps: new Map([[s.id, { status: 'ok', goalsBefore: [goal('')], goalsAfter: [goal('zero'), goal('succ')], errors: [] }]]),
      placeholderGoals: null,
      headerErrors: [],
      unsolved: [],
      otherErrors: [],
    } as unknown as Evaluation;
    expect(checkpointAt(doc, ev, 0).goals?.map((g) => g.tag)).toEqual(['']);
    expect(checkpointAt(doc, ev, 1).goals?.map((g) => g.tag)).toEqual(['zero', 'succ']);
  });

  it('uses the goals at the placeholder of an empty proof', () => {
    const ev = { steps: new Map(), placeholderGoals: [goal('')] } as unknown as Evaluation;
    expect(checkpointAt(emptyDocument(), ev, 0).goals).toEqual([goal('')]);
  });
});

describe('hidden names', () => {
  it("offers Lean's own names for the hypotheses it hides, in order", () => {
    const hyps = [
      { id: 'a', name: 'm', inaccessible: false, type: 'Natural' },
      { id: 'b', name: 'n✝', inaccessible: true, type: 'Natural' },
      { id: 'c', name: 'n_ih✝', inaccessible: true, type: 'P n' },
    ];
    expect(hiddenNames(goal('succ', hyps))).toEqual(['n', 'n_ih']);
    expect(hiddenNames(null)).toEqual([]);
  });
});
