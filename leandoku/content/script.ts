import type { SlotValue } from '../src/core/catalog/types';
import type { ScriptStep } from '../src/core/course/types';

/** Shorthands for writing reference solutions as builder actions. */
export const local = (name: string): SlotValue => ({ kind: 'local', name });
export const term = (text: string): SlotValue => ({ kind: 'term', text });
export const names = (...ns: string[]): SlotValue => ({ kind: 'names', names: ns });

/** `rules('add_succ', '← h')` is `rw [add_succ, ← h]`. */
export const rules = (...rs: string[]): SlotValue => ({
  kind: 'rules',
  rules: rs.map((r) => (r.startsWith('←') ? { term: r.slice(1).trim(), reverse: true } : { term: r, reverse: false })),
});

export const step = (tactic: string, args?: Record<string, SlotValue>): ScriptStep => (args ? { tactic, args } : { tactic });
export const rfl = step('rfl');
export const assumption = step('assumption');
export const constructor = step('constructor');
export const intro = (...ns: string[]) => step('intro', { names: names(...ns) });
export const apply = (t: string) => step('apply', { term: term(t) });
export const rw = (...rs: string[]) => step('rw', { rules: rules(...rs) });

/**
 * A step that leaves several goals, then the steps for each goal in the
 * order Lean lists them. It is one plain tactic sequence; the grouping is
 * only for reading the solution.
 */
export const split = (s: ScriptStep, ...goals: ScriptStep[][]): ScriptStep[] => [s, ...goals.flat()];

export const exact = (t: string) => step('exact', { term: term(t) });
export const renameI = (...ns: string[]) => step('rename_i', { names: names(...ns) });
export const funext = (...ns: string[]) => step('funext', { names: names(...ns) });

/** `unfold A B` on the goal, or `unfold A at h`. */
export const unfold = (defs: string[], at?: string): ScriptStep =>
  step('unfold', at ? { defs: { kind: 'definitions', names: defs }, at: { kind: 'location', hyp: at } } : { defs: { kind: 'definitions', names: defs } });

/** `rw [...] at h`. */
export const rwAt = (h: string, ...rs: string[]): ScriptStep => step('rw', { rules: rules(...rs), at: { kind: 'location', hyp: h } });

export const induction = (x: string) => step('induction', { target: local(x) });
export const cases = (x: string) => step('cases', { target: local(x) });

/** `cases h` on `h : A ∧ B`, then `rename_i a b` to name its halves, then `rest`. */
export const casesAnd = (h: string, a: string, b: string, rest: ScriptStep[]): ScriptStep[] => [cases(h), renameI(a, b), ...rest];
