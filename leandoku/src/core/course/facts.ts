import type { Course, Level } from './types';

export interface Fact {
  name: string;
  /** The statement as declared, e.g. `(n : Natural) : n + zero = n`. */
  statement: string;
  /** The level that proves it, or `null` for a fact from Lean's library. */
  level: string | null;
}

/** Every level this one builds on, transitively. */
export function prerequisiteClosure(course: Course, levelIds: readonly string[]): Set<string> {
  const byId = new Map(course.levels.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const visit = (id: string): void => {
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      visit(p);
    }
  };
  levelIds.forEach(visit);
  return seen;
}

/**
 * Earlier levels whose theorems this level may cite, in course order: its
 * prerequisites, transitively, narrowed to the names its policy lists.
 */
export function citableLevels(course: Course, level: Level): Level[] {
  const seen = prerequisiteClosure(course, [level.id]);
  const allowed = level.policy.facts;
  return course.levels.filter((l) => seen.has(l.id) && (allowed === 'all' || allowed.includes(l.theoremName)));
}

/**
 * Theorems this level may cite: the earlier levels its policy allows, then
 * the library facts the level itself offers.
 */
export function factsFor(course: Course, level: Level): Fact[] {
  return citableLevels(course, level)
    .map((l): Fact => ({ name: l.theoremName, statement: statementOf(l), level: l.id }))
    .concat((level.library ?? []).map((f) => ({ name: f.name, statement: f.statement, level: null })));
}

/** `theorem add_zero (n : Natural) : n + zero = n := by` → `(n : Natural) : n + zero = n`. */
export function statementOf(level: Level): string {
  return level.header
    .replace(/^\s*theorem\s+\S+\s*/, '')
    .replace(/\s*:=\s*by\s*$/, '')
    .trim();
}
