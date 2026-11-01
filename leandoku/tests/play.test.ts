import { describe, expect, it } from 'vitest';
import { makeStep } from '../src/core/document/edit';
import { defaultCaseNames } from '../src/core/play/play';

const hyp = (name: string, inaccessible = true) => ({ id: name, name, inaccessible, type: 'T' });

describe('default case names', () => {
  it('names the new variable after the induction target and the hypothesis ih', () => {
    const step = makeStep('induction', { target: { kind: 'local', name: 'n' } });
    expect(defaultCaseNames(step, { id: 'g', tag: 'succ', target: 'P', hyps: [hyp('a✝'), hyp('a_ih✝')] })).toEqual(['n', 'ih']);
  });

  it('avoids names already in the goal', () => {
    const step = makeStep('induction', { target: { kind: 'local', name: 'n' } });
    const goal = { id: 'g', tag: 'succ', target: 'P', hyps: [hyp('ih', false), hyp('n', false), hyp('a✝'), hyp('a_ih✝')] };
    expect(defaultCaseNames(step, goal)).toEqual(['n1', 'ih1']);
  });
});

import { defaultCatalog } from '../src/core/catalog/registry';
import { ROOT_BRANCH, emptyDocument, insertStep, setBranches } from '../src/core/document/edit';
import { autoBranch } from '../src/core/play/play';
import type { Evaluation } from '../src/core/evaluate/evaluate';

describe('auto branching', () => {
  const catalog = defaultCatalog();
  const goal = (tag: string) => ({ id: tag, tag, target: 'P', hyps: [] });
  const evWith = (id: string, after: ReturnType<typeof goal>[]): Evaluation => ({
    status: 'incomplete',
    steps: new Map([[id, { status: 'ok', goalsBefore: [goal('')], goalsAfter: after, errors: [] }]]),
    branches: new Map(),
    headerErrors: [],
    unsolved: [],
    otherErrors: [],
  });

  it('opens one branch per goal a split leaves', () => {
    const s = makeStep('constructor');
    const doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, s);
    const next = autoBranch(doc, evWith(s.id, [goal('left'), goal('right')]), catalog);
    expect(next.root.steps[0]!.branches?.map((b) => b.tag)).toEqual(['left', 'right']);
  });

  it('leaves written-out cases alone even though Lean then reports no goals after the step', () => {
    const s = makeStep('induction', { target: { kind: 'local', name: 'n' } });
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, s);
    doc = setBranches(doc, s.id, [{ tag: 'zero' }, { tag: 'succ' }]);
    expect(autoBranch(doc, evWith(s.id, []), catalog)).toBe(doc);
  });
});

import { firstOpenPoint, openGoals } from '../src/core/play/play';

describe('open goals across cases', () => {
  const goal = (tag: string) => ({ id: tag, tag, target: `P ${tag}`, hyps: [] });

  it("lists every case's goal in order, like Lean's goal list", () => {
    const s = makeStep('induction', { target: { kind: 'local', name: 'n' } });
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, s);
    doc = setBranches(doc, s.id, [{ tag: 'zero' }, { tag: 'succ' }]);
    const [zero, succ] = doc.root.steps[0]!.branches!;
    const r = makeStep('rfl');
    doc = insertStep(doc, { branch: zero!.id, index: 0 }, r);
    const ev: Evaluation = {
      status: 'incomplete',
      steps: new Map([
        [s.id, { status: 'ok', goalsBefore: [goal('')], goalsAfter: [], errors: [] }],
        [r.id, { status: 'ok', goalsBefore: [goal('zero')], goalsAfter: [], errors: [] }],
      ]),
      branches: new Map([
        [zero!.id, { goal: goal('zero') }],
        [succ!.id, { goal: goal('succ') }],
      ]),
      headerErrors: [],
      unsolved: [],
      otherErrors: [],
    } as unknown as Evaluation;
    // zero is finished by rfl, so only succ is left, and that is where the cursor goes next.
    expect(openGoals(doc, ev).map((o) => o.goal.tag)).toEqual(['succ']);
    expect(firstOpenPoint(doc, ev)).toEqual({ branch: succ!.id, index: 0 });
  });
});
