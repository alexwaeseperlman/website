import type { SlotSpec, SlotValue, TacticSpec } from './types';

const takesName = (s: SlotSpec) => s.kind === 'term' || s.kind === 'local' || s.kind === 'rules';

/**
 * Put a tapped name into a tactic: into the first slot that is still empty
 * and takes a name, or onto the end of a rewrite list. Returns `null` when
 * no slot can take it.
 */
export function fillWithName(
  spec: TacticSpec,
  args: Readonly<Record<string, SlotValue>>,
  name: string,
): Record<string, SlotValue> | null {
  const slot = spec.slots.find((s) => takesName(s) && (s.kind === 'rules' || args[s.id] === undefined)) ?? spec.slots.find(takesName);
  if (!slot) return null;
  return withOption(slot, args, name);
}

/**
 * The arguments after choosing `name` in `slot`: a rewrite list grows by one
 * rule, any other slot takes the name as its value.
 */
export function withOption(
  slot: SlotSpec,
  args: Readonly<Record<string, SlotValue>>,
  name: string,
  reverse = false,
): Record<string, SlotValue> {
  const next = { ...args };
  if (slot.kind === 'rules') {
    const prev = args[slot.id];
    const rules = prev?.kind === 'rules' ? prev.rules : [];
    next[slot.id] = { kind: 'rules', rules: [...rules, { term: name, reverse }] };
  } else if (slot.kind === 'local') next[slot.id] = { kind: 'local', name };
  else next[slot.id] = { kind: 'term', text: name };
  return next;
}

/** Every way a tactic in `specs` can take `name` as its one argument. */
export function usesOfName(specs: readonly TacticSpec[], name: string): { spec: TacticSpec; args: Record<string, SlotValue> }[] {
  return specs.flatMap((spec) => {
    const args = fillWithName(spec, {}, name);
    return args ? [{ spec, args }] : [];
  });
}
