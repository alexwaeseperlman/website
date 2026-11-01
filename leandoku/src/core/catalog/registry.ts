import { fillTemplate, templateSlotIds } from './slots';
import type { SlotValue, TacticSpec } from './types';
import { BUILTIN_TACTICS } from './tactics';

export class TacticCatalog {
  private readonly byId = new Map<string, TacticSpec>();

  constructor(entries: readonly TacticSpec[] = []) {
    for (const e of entries) this.register(e);
  }

  register(spec: TacticSpec): void {
    if (this.byId.has(spec.id)) throw new Error(`tactic "${spec.id}" is already registered`);
    const declared = new Set(spec.slots.map((s) => s.id));
    if (declared.size !== spec.slots.length) throw new Error(`tactic "${spec.id}" repeats a slot id`);
    for (const id of templateSlotIds(spec.template)) {
      if (!declared.has(id)) throw new Error(`tactic "${spec.id}" template uses undeclared slot "${id}"`);
    }
    this.byId.set(spec.id, spec);
  }

  get(id: string): TacticSpec | undefined {
    return this.byId.get(id);
  }

  require(id: string): TacticSpec {
    const spec = this.byId.get(id);
    if (!spec) throw new Error(`unknown tactic "${id}"`);
    return spec;
  }

  all(): TacticSpec[] {
    return [...this.byId.values()];
  }

  /** The tactic's Lean text, or `null` while a required slot is empty. */
  render(id: string, args: Readonly<Record<string, SlotValue | undefined>>): string | null {
    const spec = this.require(id);
    return fillTemplate(spec.template, spec.slots, args);
  }
}

export function defaultCatalog(): TacticCatalog {
  return new TacticCatalog(BUILTIN_TACTICS);
}
