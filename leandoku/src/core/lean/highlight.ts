/**
 * A small Lean tokenizer for colouring code on screen. It only has to look
 * right for the Lean this course shows (statements, tactic proofs, goals),
 * so it works line by line and never needs to parse.
 */

export type TokenKind =
  | 'keyword' // theorem, by, fun, with …
  | 'tactic' // rfl, rw, induction …
  | 'sorry'
  | 'decl' // the name a declaration introduces
  | 'type' // capitalised names: Natural, Prop, Eq.symm's Eq …
  | 'op' // → ∧ = ⊢ := | · …
  | 'number'
  | 'comment'
  | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'theorem', 'lemma', 'def', 'example', 'abbrev', 'instance', 'structure', 'inductive', 'class',
  'namespace', 'section', 'end', 'open', 'variable', 'where', 'deriving', 'universe',
  'by', 'fun', 'λ', 'with', 'at', 'match', 'let', 'have', 'show', 'from', 'if', 'then', 'else',
  'do', 'return', 'in', 'calc', 'using', 'generalizing',
]);

const TACTICS = new Set([
  'rfl', 'rw', 'rewrite', 'exact', 'apply', 'intro', 'intros', 'cases', 'rcases', 'obtain', 'induction',
  'constructor', 'assumption', 'funext', 'unfold', 'simp', 'simp_all', 'left', 'right', 'exists', 'use',
  'refine', 'specialize', 'contradiction', 'exfalso', 'trivial', 'decide', 'omega', 'next', 'case',
  'symm', 'congr', 'ext', 'repeat', 'first', 'try', 'all_goals', 'any_goals', 'exact?', 'change',
]);

/** Keywords that are followed by the name they declare. */
const DECLARES = new Set(['theorem', 'lemma', 'def', 'abbrev', 'instance', 'structure', 'inductive', 'class']);

const OPS = [':=', '=>', '<;>', '←', '→', '↔', '∧', '∨', '¬', '∀', '∃', '⊢', '=', '≠', '≤', '≥', '<', '>', '+', '*', '×', '∘', '⁻¹', '|', '·', '-', ':', '⟨', '⟩'];

const IDENT = /^[A-Za-z_Ͱ-Ͽᴀ-ᶿ₀-ₜ][A-Za-z0-9_'!?.Ͱ-Ͽᴀ-ᶿ₀-ₜ]*/;

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else out.push({ kind, text });
  };
  let declNext = false;
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('--')) {
      push('comment', rest);
      break;
    }
    const ws = /^\s+/.exec(rest);
    if (ws) {
      push('plain', ws[0]);
      i += ws[0].length;
      continue;
    }
    const num = /^\d+/.exec(rest);
    if (num) {
      push('number', num[0]);
      i += num[0].length;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      const word = id[0].replace(/\.$/, '');
      if (declNext) push('decl', word);
      else if (word === 'sorry') push('sorry', word);
      else if (KEYWORDS.has(word)) push('keyword', word);
      else if (TACTICS.has(word) && isTacticPosition(out)) push('tactic', word);
      else if (/^[A-Z]/.test(word)) push('type', word);
      else push('plain', word);
      declNext = DECLARES.has(word);
      i += word.length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (op) {
      push('op', op);
      i += op.length;
      continue;
    }
    push('plain', line[i]!);
    i += 1;
  }
  return out;
}

/**
 * A tactic name counts as one only where a tactic can start: first on its
 * line, or after `by`, `=>`, `·`, `;` or `<;>`. Elsewhere (`h.symm`, a
 * hypothesis called `left`) it is just a name.
 */
function isTacticPosition(before: Token[]): boolean {
  for (let k = before.length - 1; k >= 0; k--) {
    const t = before[k]!;
    if (t.kind === 'plain' && /^\s+$/.test(t.text)) continue;
    if (t.kind === 'keyword') return t.text === 'by';
    if (t.kind === 'op') return t.text === '=>' || t.text === '·' || t.text === '<;>';
    return t.kind === 'plain' && t.text.trim().endsWith(';');
  }
  return true;
}
