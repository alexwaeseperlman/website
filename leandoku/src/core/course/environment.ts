import type { TacticCatalog } from '../catalog/registry';
import { emptyDocument, insertStep, makeStep, setBranches, type IdSource } from '../document/edit';
import type { ProofDocument, StepId } from '../document/types';
import { serialize, type LevelSource } from '../serializer/serialize';
import type { Course, Level, ScriptStep } from './types';

/**
 * The Lean that comes before a level's theorem: the course prelude plus the
 * theorems of its prerequisites (transitively), and nothing else. A level can
 * never see a declaration the player has not unlocked.
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
  let doc = emptyDocument();
  const fill = (branch: string, steps: readonly ScriptStep[]): void => {
    steps.forEach((s, i) => {
      catalog.require(s.tactic);
      const step = makeStep(s.tactic, s.args ?? {}, ids);
      doc = insertStep(doc, { branch, index: i }, step);
      if (s.branches) {
        const tags = s.cases ? Object.keys(s.cases) : s.branches.map(() => '');
        doc = setBranches(doc, step.id, tags.map((tag) => ({ tag, names: s.cases?.[tag] ?? [] })), ids);
        const created = findStepBranches(doc, step.id);
        s.branches.forEach((sub, j) => fill(created[j]!, sub));
      }
    });
  };
  fill(doc.root.id, script);
  return doc;
}

function findStepBranches(doc: ProofDocument, id: StepId): string[] {
  const out: string[] = [];
  const go = (steps: ProofDocument['root']['steps']): void => {
    for (const s of steps) {
      if (s.id === id) out.push(...(s.branches ?? []).map((b) => b.id));
      for (const b of s.branches ?? []) go(b.steps);
    }
  };
  go(doc.root.steps);
  return out;
}
