import type { TacticCatalog } from '../catalog/registry';
import { walk } from '../document/edit';
import type { ProofDocument, StepId } from '../document/types';

/**
 * A level's pedagogical limits, applied on top of the general catalog.
 * `'all'` means no limit from the level; Lean still checks everything.
 */
export interface LevelPolicy {
  tactics: 'all' | readonly string[];
  /** Declarations the player may cite, by full name. */
  facts: 'all' | readonly string[];
}

export const UNRESTRICTED: LevelPolicy = { tactics: 'all', facts: 'all' };

export type TacticAvailability =
  | { state: 'available' }
  /** Supported by the editor, but this level does not allow it. */
  | { state: 'locked' };

export function tacticAvailability(policy: LevelPolicy, tacticId: string): TacticAvailability {
  if (policy.tactics === 'all' || policy.tactics.includes(tacticId)) return { state: 'available' };
  return { state: 'locked' };
}

/** The catalog as this level shows it: every entry, each marked available or locked. */
export function paletteFor(catalog: TacticCatalog, policy: LevelPolicy) {
  return catalog.all().map((spec) => ({ spec, availability: tacticAvailability(policy, spec.id) }));
}

export interface PolicyViolation {
  step: StepId;
  reason: string;
}

/**
 * Check a whole document against the policy. The picker already hides locked
 * tactics; this runs again before a proof counts as complete, so hiding a
 * button is never the only enforcement.
 */
export function checkPolicy(doc: ProofDocument, policy: LevelPolicy): PolicyViolation[] {
  const out: PolicyViolation[] = [];
  walk(doc.root, (b) => {
    for (const step of b.steps) {
      if (tacticAvailability(policy, step.tactic).state !== 'available') {
        out.push({ step: step.id, reason: `"${step.tactic}" is not available in this level` });
      }
    }
  });
  return out;
}
