import { describe, expect, it } from 'vitest';
import { course as naturalCourse } from '../content/course';
import { defaultCatalog } from '../src/core/catalog/registry';
import { levelSource, scriptToDocument } from '../src/core/course/environment';
import { unlockedLevels, validateCourse } from '../src/core/course/graph';
import type { Course } from '../src/core/course/types';
import { checkPolicy, paletteFor } from '../src/core/policy/policy';

describe('course', () => {
  it('has a sound prerequisite graph', () => {
    expect(validateCourse(naturalCourse)).toEqual([]);
  });

  it('detects cycles and unknown prerequisites', () => {
    const base = naturalCourse.levels[0]!;
    const bad: Course = {
      ...naturalCourse,
      levels: [
        { ...base, id: 'a', prerequisites: ['b'] },
        { ...base, id: 'b', prerequisites: ['a', 'zzz'] },
      ],
    };
    const problems = validateCourse(bad);
    expect(problems.some((p) => p.includes('cycle'))).toBe(true);
    expect(problems.some((p) => p.includes('zzz'))).toBe(true);
  });

  it('unlocks a level only when its prerequisites are done', () => {
    // Every chapter is open from the start; within a chapter, levels unlock in order.
    const open = unlockedLevels(naturalCourse, new Set());
    for (const chapter of naturalCourse.chapters) {
      const levels = naturalCourse.levels.filter((l) => l.chapter === chapter.id);
      expect(open, chapter.id).toContain(levels[0]!.id);
      expect(open, chapter.id).not.toContain(levels[1]!.id);
    }
    expect(unlockedLevels(naturalCourse, new Set(['natural.add_zero']))).toContain('natural.add_succ');
  });

  it('includes only prerequisite theorems in a level environment', () => {
    const catalog = defaultCatalog();
    const zeroAdd = naturalCourse.levels.find((l) => l.id === 'natural.zero_add')!;
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    expect(src.prelude).toContain('theorem add_zero');
    expect(src.prelude).toContain('theorem add_succ');
    expect(src.prelude).not.toContain('theorem zero_add');
    expect(src.prelude).not.toContain('theorem add_assoc');
  });

  it("compiles only the chapter preludes a level uses", () => {
    const catalog = defaultCatalog();
    const level = (id: string) => naturalCourse.levels.find((l) => l.id === id)!;
    const first = levelSource(naturalCourse, level('natural.add_zero'), catalog).prelude;
    expect(first).not.toContain('structure Group');
    expect(first).not.toContain('def compose');
    const maps = naturalCourse.levels.find((l) => l.chapter === 'maps')!;
    const src = levelSource(naturalCourse, maps, catalog).prelude;
    expect(src).toContain('def compose');
    expect(src).not.toContain('structure EuclideanSystem');
  });

  it('every reference solution uses only tactics its level allows', () => {
    const catalog = defaultCatalog();
    for (const level of naturalCourse.levels) {
      const doc = scriptToDocument(level.solution, catalog);
      expect(checkPolicy(doc, level.policy), level.id).toEqual([]);
    }
  });

  it('shows locked tactics as locked rather than removing them from the catalog', () => {
    const palette = paletteFor(defaultCatalog(), { tactics: ['rfl'], facts: [] });
    expect(palette.find((p) => p.spec.id === 'rfl')?.availability.state).toBe('available');
    expect(palette.find((p) => p.spec.id === 'rw')?.availability.state).toBe('locked');
  });
});
