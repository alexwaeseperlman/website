import { describe, expect, it } from 'vitest';
import { TacticCatalog, defaultCatalog } from '../src/core/catalog/registry';
import type { TacticSpec } from '../src/core/catalog/types';

describe('tactic catalog', () => {
  const catalog = defaultCatalog();

  it('renders required and optional slots', () => {
    expect(catalog.render('rfl', {})).toBe('rfl');
    expect(catalog.render('exact', { term: { kind: 'term', text: 'h' } })).toBe('exact h');
    expect(catalog.render('intro', {})).toBe('intro');
    expect(catalog.render('intro', { names: { kind: 'names', names: ['x', 'hx'] } })).toBe('intro x hx');
    expect(
      catalog.render('rw', {
        rules: { kind: 'rules', rules: [{ term: 'add_succ', reverse: false }, { term: 'ih', reverse: true }] },
      }),
    ).toBe('rw [add_succ, ← ih]');
    expect(
      catalog.render('rw', {
        rules: { kind: 'rules', rules: [{ term: 'h', reverse: false }] },
        at: { kind: 'location', hyp: 'h2' },
      }),
    ).toBe('rw [h] at h2');
    expect(
      catalog.render('rw', {
        rules: { kind: 'rules', rules: [{ term: 'h', reverse: false }] },
        at: { kind: 'location', hyp: null },
      }),
    ).toBe('rw [h]');
  });

  it('reports a missing required slot as incomplete, not as a shorter tactic', () => {
    expect(catalog.render('exact', {})).toBeNull();
    expect(catalog.render('exact', { term: { kind: 'term', text: '  ' } })).toBeNull();
    expect(catalog.render('rw', { rules: { kind: 'rules', rules: [] } })).toBeNull();
    expect(catalog.render('induction', { target: { kind: 'term', text: 'n' } })).toBeNull();
  });

  it('accepts a new tactic by registration alone', () => {
    const c = new TacticCatalog();
    const omega: TacticSpec = {
      id: 'calc_step',
      label: 'have',
      category: 'other',
      help: 'State an intermediate fact.',
      slots: [
        { id: 'name', kind: 'names', label: 'name' },
        { id: 'stmt', kind: 'term', label: 'statement' },
      ],
      template: 'have {name} : {stmt}',
    };
    c.register(omega);
    expect(c.render('calc_step', { name: { kind: 'names', names: ['h'] }, stmt: { kind: 'term', text: 'a = b' } })).toBe(
      'have h : a = b',
    );
  });

  it('rejects entries whose template does not match their slots', () => {
    const c = new TacticCatalog();
    expect(() =>
      c.register({ id: 'bad', label: 'bad', category: 'other', help: '', slots: [], template: 'exact {t}' }),
    ).toThrow(/undeclared slot/);
    expect(() => defaultCatalog().register({ ...defaultCatalog().require('rfl') })).toThrow(/already registered/);
  });
});
