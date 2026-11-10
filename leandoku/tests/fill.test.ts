import { describe, expect, it } from 'vitest';
import { fillWithName, usesOfName, withOption } from '../src/core/catalog/fill';
import { defaultCatalog } from '../src/core/catalog/registry';

const catalog = defaultCatalog();

describe('filling a tactic with a tapped name', () => {
  it('fills the first empty slot that takes a name', () => {
    expect(fillWithName(catalog.require('exact'), {}, 'h')).toEqual({ term: { kind: 'term', text: 'h' } });
    expect(fillWithName(catalog.require('induction'), {}, 'n')).toEqual({ target: { kind: 'local', name: 'n' } });
  });

  it('appends to a rewrite list instead of replacing it', () => {
    const rw = catalog.require('rw');
    const one = fillWithName(rw, {}, 'add_succ')!;
    const two = fillWithName(rw, one, 'ih')!;
    expect(catalog.render('rw', two)).toBe('rw [add_succ, ih]');
  });

  it('can add a rule right to left', () => {
    const rw = catalog.require('rw');
    expect(catalog.render('rw', withOption(rw.slots[0]!, {}, 'h', true))).toBe('rw [← h]');
  });

  it('says no when the tactic takes no name', () => {
    expect(fillWithName(catalog.require('rfl'), {}, 'h')).toBeNull();
    expect(fillWithName(catalog.require('intro'), {}, 'h')).toBeNull();
  });

  it('lists every tactic that can take a name, complete and ready to check', () => {
    const uses = usesOfName([catalog.require('rfl'), catalog.require('rw'), catalog.require('exact')], 'h');
    expect(uses.map((u) => catalog.render(u.spec.id, u.args))).toEqual(['rw [h]', 'exact h']);
  });
});
