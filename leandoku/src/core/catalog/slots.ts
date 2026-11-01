import type { SlotSpec, SlotValue } from './types';

/**
 * Render one slot value as Lean text. Returns `''` for a value that means
 * "nothing here" (the goal as a location, no names) and `null` when the value
 * is missing or unusable, which makes the whole tactic incomplete.
 */
export function renderSlot(spec: SlotSpec, value: SlotValue | undefined): string | null {
  if (value === undefined) return spec.optional ? '' : null;
  if (value.kind !== spec.kind) return null;
  switch (value.kind) {
    case 'term':
      return nonEmpty(value.text.trim(), spec, (t) => t);
    case 'local':
      return nonEmpty(value.name.trim(), spec, (n) => n);
    case 'names':
      return nonEmpty(value.names.map((n) => n.trim()).filter(Boolean), spec, (ns) => ns.join(' '));
    case 'rules':
      return nonEmpty(value.rules.filter((r) => r.term.trim()), spec, (rs) =>
        rs.map((r) => (r.reverse ? `← ${r.term.trim()}` : r.term.trim())).join(', '),
      );
    case 'location':
      return value.hyp === null ? '' : value.hyp.trim() || null;
    case 'definitions':
      return nonEmpty(value.names.map((n) => n.trim()).filter(Boolean), spec, (ns) => ns.join(' '));
    case 'raw':
      return nonEmpty(value.text.trim(), spec, (t) => t);
  }
}

function nonEmpty<T extends string | unknown[]>(
  v: T,
  spec: SlotSpec,
  render: (v: T) => string,
): string | null {
  if (v.length === 0) return spec.optional ? '' : null;
  return render(v);
}

const PLACEHOLDER = /\{(?:([^{}|]*)\|)?([A-Za-z0-9_]+)\}/g;

/**
 * Fill a tactic template. `{slot}` inserts the slot; `{prefix|slot}` inserts
 * the prefix too, but only when the slot renders to something non-empty.
 * Returns `null` if any required slot is missing.
 */
export function fillTemplate(
  template: string,
  slots: readonly SlotSpec[],
  values: Readonly<Record<string, SlotValue | undefined>>,
): string | null {
  let missing = false;
  const out = template.replace(PLACEHOLDER, (_m, prefix: string | undefined, id: string) => {
    const spec = slots.find((s) => s.id === id);
    if (!spec) throw new Error(`template refers to unknown slot "${id}"`);
    const text = renderSlot(spec, values[id]);
    if (text === null) {
      missing = true;
      return '';
    }
    return text === '' ? '' : (prefix ?? '') + text;
  });
  return missing ? null : out;
}

/** Slot ids a template mentions, for validating catalog entries. */
export function templateSlotIds(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[2]!);
}
