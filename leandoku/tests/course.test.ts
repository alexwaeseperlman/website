import { describe, expect, it } from 'vitest';
import { naturalCourse } from '../content/natural/course';
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
    expect(unlockedLevels(naturalCourse, new Set())).toEqual(['natural.add_zero']);
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
