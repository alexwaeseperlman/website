import { describe, expect, it } from 'vitest';
import { tokenize, type TokenKind } from '../src/core/lean/highlight';

/** The kind of the first token whose text is exactly `word`, or 'plain' if it was merged into plain text. */
const kindOf = (line: string, word: string): TokenKind => tokenize(line).find((t) => t.text === word)?.kind ?? 'plain';

describe('tokenize', () => {
  it('colours a theorem header', () => {
    const h = 'theorem zero_add (n : Natural) : zero + n = n := by';
    expect(kindOf(h, 'theorem')).toBe('keyword');
    expect(kindOf(h, 'zero_add')).toBe('decl');
    expect(kindOf(h, 'Natural')).toBe('type');
    expect(kindOf(h, ':=')).toBe('op');
    expect(kindOf(h, '+')).toBe('op');
    expect(kindOf(h, 'by')).toBe('keyword');
  });

  it('marks tactics only where a tactic starts', () => {
    expect(kindOf('  rw [add_succ, ih]', 'rw')).toBe('tactic');
    expect(kindOf('  | succ k ih => rfl', 'rfl')).toBe('tactic');
    expect(kindOf('  · exact hp', 'exact')).toBe('tactic');
    expect(kindOf('  exact h.left', 'h.left')).toBe('plain');
    expect(kindOf('  apply left', 'left')).toBe('plain');
    expect(kindOf('  sorry', 'sorry')).toBe('sorry');
  });

  it('keeps every character', () => {
    const line = '  cases h with -- split it ⟨a, b⟩';
    expect(tokenize(line).map((t) => t.text).join('')).toBe(line);
    expect(tokenize(line).at(-1)).toEqual({ kind: 'comment', text: '-- split it ⟨a, b⟩' });
  });
});
