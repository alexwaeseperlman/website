import type { TacticCatalog } from '../catalog/registry';
import { emptyDocument, makeStep, type IdSource } from '../document/edit';
import type { ProofDocument } from '../document/types';
import { serialize, type LevelSource } from '../serializer/serialize';
import type { Course, Level, ScriptStep } from './types';

/**
 * The Lean that comes before a level's theorem: the course prelude, the
 * preludes of the chapters it draws on, then the theorems of its
 * prerequisites (transitively), and nothing else. A level can never see a
 * declaration the player has not unlocked.
 */
export function levelSource(course: Course, level: Level, catalog: TacticCatalog): LevelSource {
  const byId = new Map(course.levels.map((l) => [l.id, l]));
  const needed = new Set<string>();
  const collect = (id: string): void => {
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (!needed.has(p)) {
        needed.add(p);
        collect(p);
      }
    }
  };
  collect(level.id);

  const parts = [course.prelude.trimEnd()];
  for (const c of chaptersFor(course, [level.id, ...needed])) if (c.prelude) parts.push(c.prelude.trimEnd());
  // Course order is a valid topological order (validateCourse checks the graph).
  for (const l of course.levels) {
    if (!needed.has(l.id)) continue;
    const proof = serialize(scriptToDocument(l.solution, catalog), catalog, { prelude: '', theoremName: l.theoremName, header: l.header });
    parts.push(proof.source.trimEnd());
  }
  return { prelude: parts.join('\n\n'), theoremName: level.theoremName, header: level.header };
}

/** Build the document a script describes, all at once (no Lean in the loop). */
export function scriptToDocument(script: readonly ScriptStep[], catalog: TacticCatalog, ids?: IdSource): ProofDocument {
  const steps = script.map((s) => {
    catalog.require(s.tactic);
    return makeStep(s.tactic, s.args ?? {}, ids);
  });
  return { ...emptyDocument(), steps };
}

/** The chapters these levels belong to, plus what those chapters need, in course order. */
function chaptersFor(course: Course, levelIds: readonly string[]) {
  const byLevel = new Map(course.levels.map((l) => [l.id, l.chapter]));
  const byId = new Map(course.chapters.map((c) => [c.id, c]));
  const wanted = new Set<string>();
  const add = (id: string): void => {
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const n of byId.get(id)?.needs ?? []) add(n);
  };
  for (const l of levelIds) {
    const c = byLevel.get(l);
    if (c) add(c);
  }
  return course.chapters.filter((c) => wanted.has(c.id));
}
