import { describe, expect, it } from 'vitest';
import { defaultCatalog } from '../src/core/catalog/registry';
import { scriptToDocument } from '../src/core/course/environment';
import { emptyDocument } from '../src/core/document/edit';
import { serialize } from '../src/core/serializer/serialize';
import { counterIds } from './helpers';

const catalog = defaultCatalog();
const level = { prelude: 'def x := 1', theoremName: 't', header: 'theorem t (n : Nat) : n = n := by' };

describe('serializer', () => {
  it('writes a visible placeholder for an empty proof', () => {
    const out = serialize(emptyDocument(), catalog, level);
    expect(out.source).toBe('def x := 1\n\ntheorem t (n : Nat) : n = n := by\n  sorry\n');
    expect(out.branches.get('root')).toEqual({ line: 4, col: 2 });
    expect(out.headerLines).toEqual({ start: 3, end: 3 });
  });

  it('writes induction cases as named alternatives with a source map', () => {
    const doc = scriptToDocument(
      [
        {
          tactic: 'induction',
          args: { target: { kind: 'local', name: 'n' } },
          cases: { zero: [], succ: ['m', 'ih'] },
          branches: [[{ tactic: 'rfl' }], []],
        },
      ],
      catalog,
      counterIds(),
    );
    const out = serialize(doc, catalog, level);
    expect(out.source.split('\n').slice(2)).toEqual([
      'theorem t (n : Nat) : n = n := by',
      '  induction n with',
      '  | zero =>',
      '      rfl',
      '  | succ m ih =>',
      '      sorry',
      '',
    ]);
    // s1 = induction step, s2/s3 = branches, s4 = rfl
    expect(out.steps.get('s1')).toEqual({ line: 4, col: 2 });
    expect(out.steps.get('s4')).toEqual({ line: 6, col: 6 });
    expect(out.branches.get('s3')).toEqual({ line: 8, col: 6 });
  });

  it('writes other splits as bullets', () => {
    const doc = scriptToDocument(
      [{ tactic: 'constructor', branches: [[{ tactic: 'rfl' }, { tactic: 'rfl' }], []] }],
      catalog,
      counterIds(),
    );
    const out = serialize(doc, catalog, { ...level, prelude: '' });
    expect(out.source).toBe(
      ['theorem t (n : Nat) : n = n := by', '  constructor', '  · rfl', '    rfl', '  · sorry', ''].join('\n'),
    );
    expect(out.branches.get('s2')).toEqual({ line: 3, col: 4 });
    expect(out.steps.get('s5')).toEqual({ line: 4, col: 4 });
  });
});
