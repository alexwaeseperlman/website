import type { TacticCatalog } from '../catalog/registry';
import { serialize } from '../serializer/serialize';
import { levelSource, scriptToDocument } from './environment';
import type { Course, ScriptStep } from './types';

/** How many shallow levels the warm-up replays. */
const WARM_UP_LEVELS = 12;

const usesInduction = (steps: readonly ScriptStep[]): boolean =>
  steps.some((s) => s.tactic === 'induction' || (s.branches ?? []).some(usesInduction));

/**
 * Solved levels for Lean to check, and throw away, before the player's first
 * check: the first few in course order whose solutions don't use induction.
 * They exercise the course's own definitions and the common tactics without
 * going deep, which is what a cold Safari needs before a deep proof fits its
 * stack (see HostOptions.warmUp).
 */
export function warmUpChecks(course: Course, catalog: TacticCatalog): { source: string; theoremName: string }[] {
  return course.levels
    .filter((l) => !usesInduction(l.solution))
    .slice(0, WARM_UP_LEVELS)
    .map((l) => ({
      source: serialize(scriptToDocument(l.solution, catalog), catalog, levelSource(course, l, catalog)).source,
      theoremName: l.theoremName,
    }));
}
