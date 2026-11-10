import { describe, expect, it } from 'vitest';
import { defaultCatalog } from '../src/core/catalog/registry';
import { makeStep } from '../src/core/document/edit';
import { errorSummary, hasMoreThanSummary } from '../src/core/play/errors';
import { asExample, probeSource, readProbe } from '../src/core/play/probe';
import type { CheckResponse, Goal } from '../src/engine/protocol';
import { counterIds } from './helpers';

const catalog = defaultCatalog();
const level = { prelude: 'def one := 1', theoremName: 't', header: 'theorem t (n : Nat) :\n    n = n := by' };
const rw = (...terms: string[]) => ({ tactic: 'rw', args: { rules: { kind: 'rules' as const, rules: terms.map((term) => ({ term, reverse: false })) } } });

describe('probing candidate steps', () => {
  const ids = counterIds();
  const doc = { revision: 2, steps: [makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids), makeStep('rfl', {}, ids)] };

  it('writes one example per candidate: the statement, the steps before, then the candidate', () => {
    const probe = probeSource(doc, 1, [rw('a'), rw('b')], catalog, level);
    expect(probe.source).toBe(
      [
        'def one := 1',
        '',
        'example (n : Nat) :',
        '    n = n := by',
        '  induction n',
        '  rw [a]',
        '',
        'example (n : Nat) :',
        '    n = n := by',
        '  induction n',
        '  rw [b]',
        '',
        '',
      ].join('\n'),
    );
    expect(probe.marks).toEqual([{ line: 6, col: 2 }, { line: 11, col: 2 }]);
  });

  it('leaves out a candidate that is not a complete tactic yet', () => {
    const probe = probeSource(doc, 0, [{ tactic: 'rw', args: {} }, { tactic: 'rfl', args: {} }], catalog, level);
    expect(probe.marks).toEqual([null, { line: 5, col: 2 }]);
  });

  it('only renames the declaration keyword', () => {
    expect(asExample('theorem add_zero (n : Natural) : n + zero = n := by')).toBe('example (n : Natural) : n + zero = n := by');
  });

  it("reads each candidate's goals or error from Lean's response", () => {
    const probe = probeSource(doc, 1, [rw('a'), rw('b'), { tactic: 'rw', args: {} }], catalog, level);
    const goal: Goal = { id: 'g', tag: '', hyps: [], target: 'x = y' };
    const at = (line: number) => ({ startLine: line, startCol: 2, endLine: line, endCol: 8 });
    const res: CheckResponse = {
      version: 1,
      requestId: 'p',
      tactics: [{ range: at(6), kind: 'rw', goalsBefore: [goal, goal], goalsAfter: [goal] }],
      messages: [
        { severity: 'error', range: { ...at(3), startCol: 0 }, text: 'unsolved goals\n⊢ x = y' },
        { severity: 'error', range: at(11), text: 'Did not find an occurrence of the pattern' },
      ],
    };
    expect(readProbe(probe, res)).toEqual([
      { kind: 'ok', goals: [goal] },
      { kind: 'error', text: 'Did not find an occurrence of the pattern' },
      { kind: 'unknown' },
    ]);
  });
});

describe('error summaries', () => {
  const text = 'Tactic `rfl` failed: The left-hand side\n  zero + n\nis not definitionally equal to the right-hand side\n  n\n\nn : Natural\n⊢ zero + n = n';

  it('keeps what went wrong and drops the goal Lean repeats after it', () => {
    expect(errorSummary(text)).toBe('Tactic `rfl` failed: The left-hand side zero + n is not definitionally equal to the right-hand side n');
    expect(hasMoreThanSummary(text)).toBe(true);
  });

  it('has nothing more to show for a one-line message', () => {
    expect(hasMoreThanSummary('unknown identifier `foo`')).toBe(false);
  });
});
