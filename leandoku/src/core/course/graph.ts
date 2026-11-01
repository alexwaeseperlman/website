import type { Course } from './types';

/** Problems with a course's prerequisite graph; an empty list means it is sound. */
export function validateCourse(course: Course): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const l of course.levels) {
    if (ids.has(l.id)) problems.push(`duplicate level id ${l.id}`);
    ids.add(l.id);
  }
  for (const l of course.levels) {
    for (const p of l.prerequisites) if (!ids.has(p)) problems.push(`${l.id} requires unknown level ${p}`);
  }
  const chapters = new Set(course.chapters.map((c) => c.id));
  for (const l of course.levels) {
    if (!chapters.has(l.chapter)) problems.push(`${l.id} is in unknown chapter ${l.chapter}`);
  }
  for (const c of course.chapters) {
    for (const n of c.needs ?? []) if (!chapters.has(n)) problems.push(`chapter ${c.id} needs unknown chapter ${n}`);
  }
  const tutorialIds = new Set<string>();
  const definitions = new Set(course.definitions.map((d) => d.name));
  for (const t of course.tutorials) {
    if (tutorialIds.has(t.id) || ids.has(t.id)) problems.push(`duplicate id ${t.id}`);
    tutorialIds.add(t.id);
    if (!ids.has(t.before)) problems.push(`tutorial ${t.id} comes before unknown level ${t.before}`);
    for (const d of t.definitions ?? []) if (!definitions.has(d)) problems.push(`tutorial ${t.id} shows unknown definition ${d}`);
  }
  // Detect cycles with a depth-first search.
  const state = new Map<string, 'visiting' | 'done'>();
  const byId = new Map(course.levels.map((l) => [l.id, l]));
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      problems.push(`prerequisite cycle: ${[...path, id].join(' → ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const p of byId.get(id)?.prerequisites ?? []) if (byId.has(p)) visit(p, [...path, id]);
    state.set(id, 'done');
  };
  for (const l of course.levels) visit(l.id, []);
  return problems;
}

/** Levels the player can open: every prerequisite completed. */
export function unlockedLevels(course: Course, completed: ReadonlySet<string>): string[] {
  return course.levels.filter((l) => l.prerequisites.every((p) => completed.has(p))).map((l) => l.id);
}
