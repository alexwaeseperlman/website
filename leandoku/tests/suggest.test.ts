import { describe, expect, it } from 'vitest';
import { defaultCatalog } from '../src/core/catalog/registry';
import { fillWithName, hasTopLevel, stageHypothesis, suggestTactics } from '../src/core/catalog/suggest';
import type { Goal } from '../src/engine/protocol';

const goal = (target: string, hyps: [string, string][] = []): Goal => ({
  id: 'g',
  tag: '',
  target,
  hyps: hyps.map(([name, type], i) => ({ id: `h${i}`, name, type, inaccessible: false })),
});
const all = new Set(defaultCatalog().all().map((s) => s.id));

describe('suggestions', () => {
  it('reads connectives outside brackets only', () => {
    expect(hasTopLevel('P ∧ (Q → R)', '→')).toBe(false);
    expect(hasTopLevel('P ∧ (Q → R)', '∧')).toBe(true);
    expect(hasTopLevel('a := b', '=')).toBe(false);
  });

  it('suggests moves that fit the goal, within the level', () => {
    expect(suggestTactics(goal('Q ∧ P', [['h', 'P ∧ Q']]), all)).toEqual(['constructor', 'cases']);
    expect(suggestTactics(goal('P → R', [['hPQ', 'P → Q']]), all)).toEqual(['intro', 'apply']);
    expect(suggestTactics(goal('P', [['hp', 'P']]), new Set(['assumption']))).toEqual(['assumption']);
    expect(suggestTactics(goal('P → R'), new Set(['rfl']))).toEqual([]);
  });

  it('turns a tapped hypothesis into the move that uses it', () => {
    const g = goal('b = a', [['h', 'a = b']]);
    expect(stageHypothesis({ name: 'h', type: 'a = b' }, g, all)?.tactic).toBe('rw');
    expect(stageHypothesis({ name: 'h', type: 'P ∧ Q' }, g, all)?.tactic).toBe('cases');
    expect(stageHypothesis({ name: 'f', type: 'P → b = a' }, g, all)?.tactic).toBe('apply');
    expect(stageHypothesis({ name: 'h', type: 'b = a' }, g, new Set(['assumption']))?.tactic).toBe('assumption');
    expect(stageHypothesis({ name: 'h', type: 'a = b' }, g, new Set(['rfl']))).toBeNull();
  });

  it('fills the open tactic with a tapped name', () => {
    const c = defaultCatalog();
    const rw = fillWithName(c.require('rw'), {}, 'h')!;
    expect(c.render('rw', fillWithName(c.require('rw'), rw, 'add_succ')!)).toBe('rw [h, add_succ]');
    expect(c.render('apply', fillWithName(c.require('apply'), {}, 'hPQ')!)).toBe('apply hPQ');
    expect(fillWithName(c.require('rfl'), {}, 'h')).toBeNull();
  });
});
