import type { TacticCatalog } from '../catalog/registry';
import { serialize } from '../serializer/serialize';
import { levelSource, scriptToDocument } from './environment';
import { citableLevels, prerequisiteClosure } from './facts';
import type { Course, Level, ScriptStep } from './types';

/** How many shallow levels the warm-up replays. */
const WARM_UP_LEVELS = 12;

const usesInduction = (steps: readonly ScriptStep[]): boolean => steps.some((s) => s.tactic === 'induction');

/**
 * Solved levels for Lean to check, and throw away, before the player's first
 * check: the first few in course order whose sources hold no induction.
 * They exercise the course's own definitions and the common tactics without
 * going deep, which is what a cold Safari needs before a deep proof fits its
 * stack (see HostOptions.warmUp).
 */
export function warmUpChecks(course: Course, catalog: TacticCatalog): { source: string; theoremName: string }[] {
  const byId = new Map(course.levels.map((l) => [l.id, l]));
  // A level's source also holds the proofs of the theorems it may cite.
  const shallow = (l: Level): boolean => {
    const cited = citableLevels(course, l).map((c) => c.id);
    const inSource = [l, ...[...cited, ...prerequisiteClosure(course, cited)].map((id) => byId.get(id)!)];
    return inSource.every((x) => !usesInduction(x.solution));
  };
  return course.levels
    .filter(shallow)
    .slice(0, WARM_UP_LEVELS)
    .map((l) => ({
      source: serialize(scriptToDocument(l.solution, catalog), catalog, levelSource(course, l, catalog)).source,
      theoremName: l.theoremName,
    }));
}
