import { describe, expect, it } from 'vitest';
import { course } from '../content/course';
import { defaultCatalog } from '../src/core/catalog/registry';
import { warmUpChecks } from '../src/core/course/warm-up';

describe('warmUpChecks', () => {
  it('replays shallow solved levels with their full sources', () => {
    const checks = warmUpChecks(course, defaultCatalog());
    expect(checks.length).toBeGreaterThan(5);
    for (const c of checks) {
      expect(c.source).toContain(`theorem ${c.theoremName}`);
      expect(c.source).not.toContain('induction');
    }
  });
});
