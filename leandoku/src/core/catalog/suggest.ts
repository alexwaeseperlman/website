import type { Goal, Hyp } from '../../engine/protocol';
import type { SlotSpec, SlotValue, TacticSpec } from './types';

/**
 * Hints read off the shape of the goal. They only reorder and preselect;
 * Lean still decides whether a step works, so a wrong guess costs nothing.
 */

/** Whether `op` occurs in `text` outside every bracket. */
export function hasTopLevel(text: string, op: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{' || c === '⟨') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '⟩') depth--;
    else if (depth === 0 && text.startsWith(op, i)) {
      if (op === '=' && (text[i - 1] === ':' || text[i - 1] === '!' || text[i + 1] === '>' || text[i - 1] === '<' || text[i - 1] === '>')) continue;
      return true;
    }
  }
  return false;
}

const isImplication = (t: string) => t.trimStart().startsWith('¬') || t.trimStart().startsWith('∀') || hasTopLevel(t, '→');
const isEquation = (t: string) => hasTopLevel(t, '=') && !isImplication(t);
const isConjunction = (t: string) => hasTopLevel(t, '∧') && !isImplication(t) && !hasTopLevel(t, '↔');
const isIff = (t: string) => hasTopLevel(t, '↔') && !hasTopLevel(t, '→');

/** Allowed tactics that fit the goal's shape, best first. */
export function suggestTactics(goal: Goal | null, allowed: ReadonlySet<string>): string[] {
  if (!goal) return [];
  const t = goal.target;
  const out: string[] = [];
  const add = (id: string) => {
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  };
  const usable = goal.hyps.filter((h) => !h.inaccessible);
  if (usable.some((h) => h.type.trim() === t.trim())) add('assumption');
  if (isImplication(t)) add('intro');
  if (isConjunction(t) || isIff(t)) add('constructor');
  if (usable.some((h) => isConjunction(h.type))) add('cases');
  if (isEquation(t)) {
    if (/^\s*\(?\s*fun\b|→/.test(t) || /\bcompose/.test(t)) add('funext');
    add('rfl');
    add('rw');
  }
  if (usable.some((h) => isImplication(h.type))) add('apply');
  if (isEquation(t) && usable.some((h) => h.type.includes('Natural'))) add('induction');
  return out;
}

/**
 * What tapping a hypothesis does when no tactic is open: the move that uses
 * it most directly, if the level allows that move.
 */
export function stageHypothesis(
  hyp: Pick<Hyp, 'name' | 'type'>,
  goal: Goal,
  allowed: ReadonlySet<string>,
): { tactic: string; args: Record<string, SlotValue> } | null {
  const term: SlotValue = { kind: 'term', text: hyp.name };
  if (hyp.type.trim() === goal.target.trim()) {
    if (allowed.has('exact')) return { tactic: 'exact', args: { term } };
    if (allowed.has('assumption')) return { tactic: 'assumption', args: {} };
  }
  if (isConjunction(hyp.type) && allowed.has('cases')) return { tactic: 'cases', args: { target: { kind: 'local', name: hyp.name } } };
  if (isEquation(hyp.type) && allowed.has('rw')) {
    return { tactic: 'rw', args: { rules: { kind: 'rules', rules: [{ term: hyp.name, reverse: false }] } } };
  }
  if (isImplication(hyp.type) && allowed.has('apply')) return { tactic: 'apply', args: { term } };
  if (/^\s*(Natural|Nat)\s*$/.test(hyp.type) && allowed.has('induction')) {
    return { tactic: 'induction', args: { target: { kind: 'local', name: hyp.name } } };
  }
  return null;
}

/**
 * Put a tapped name into the open tactic: into the first slot that is still
 * empty and takes a name, or onto the end of a rewrite list. Returns `null`
 * when no slot can take it.
 */
export function fillWithName(
  spec: TacticSpec,
  args: Readonly<Record<string, SlotValue>>,
  name: string,
): Record<string, SlotValue> | null {
  const takes = (s: SlotSpec) => s.kind === 'term' || s.kind === 'local' || s.kind === 'rules';
  const slot = spec.slots.find((s) => takes(s) && (s.kind === 'rules' || args[s.id] === undefined)) ?? spec.slots.find(takes);
  if (!slot) return null;
  const next = { ...args };
  if (slot.kind === 'rules') {
    const prev = args[slot.id];
    const rules = prev?.kind === 'rules' ? prev.rules : [];
    next[slot.id] = { kind: 'rules', rules: [...rules, { term: name, reverse: false }] };
  } else if (slot.kind === 'local') next[slot.id] = { kind: 'local', name };
  else next[slot.id] = { kind: 'term', text: name };
  return next;
}
