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
    expect(out.placeholder).toEqual({ line: 4, col: 2 });
    expect(out.headerLines).toEqual({ start: 3, end: 3 });
  });

  it('writes induction and the steps after it as one plain sequence, with nothing added', () => {
    const doc = scriptToDocument(
      [
        { tactic: 'induction', args: { target: { kind: 'local', name: 'n' } } },
        { tactic: 'rfl' },
        { tactic: 'rename_i', args: { names: { kind: 'names', names: ['m', 'ih'] } } },
      ],
      catalog,
      counterIds(),
    );
    const out = serialize(doc, catalog, { ...level, prelude: '' });
    expect(out.source).toBe(['theorem t (n : Nat) : n = n := by', '  induction n', '  rfl', '  rename_i m ih', ''].join('\n'));
    expect(out.placeholder).toBeNull();
    expect(out.steps.get('s1')).toEqual({ line: 2, col: 2 });
    expect(out.steps.get('s3')).toEqual({ line: 4, col: 2 });
  });
});
