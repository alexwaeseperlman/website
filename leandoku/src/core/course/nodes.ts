import type { Chapter, Course, Level, Tutorial } from './types';

/** A stop on the path through the course: a tutorial or a level. */
export type CourseNode = { kind: 'tutorial'; tutorial: Tutorial; chapter: Chapter } | { kind: 'level'; level: Level; chapter: Chapter };

/** Every node in play order: each level preceded by the tutorials that lead into it. */
export function courseNodes(course: Course): CourseNode[] {
  const chapters = new Map(course.chapters.map((c) => [c.id, c]));
  const out: CourseNode[] = [];
  for (const level of course.levels) {
    const chapter = chapters.get(level.chapter)!;
    for (const tutorial of course.tutorials) if (tutorial.before === level.id) out.push({ kind: 'tutorial', tutorial, chapter });
    out.push({ kind: 'level', level, chapter });
  }
  return out;
}

export function nodeId(n: CourseNode): string {
  return n.kind === 'level' ? n.level.id : n.tutorial.id;
}

/** The node after `id` in play order, if any. */
export function nextNode(course: Course, id: string): CourseNode | undefined {
  const nodes = courseNodes(course);
  const i = nodes.findIndex((n) => nodeId(n) === id);
  return i < 0 ? undefined : nodes[i + 1];
}

export function tutorialsBefore(course: Course, levelId: string): Tutorial[] {
  return course.tutorials.filter((t) => t.before === levelId);
}
