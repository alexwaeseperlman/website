import type { TacticCatalog } from '../catalog/registry';
import type { ProofDocument, StepId } from '../document/types';

/** A position in the generated source, in Lean's convention (1-based line, code-point column). */
export interface SourcePos {
  line: number;
  col: number;
}

export interface LevelSource {
  /** Definitions the statement needs, emitted before the theorem. */
  prelude: string;
  /** Declaration name, used for the completion check. */
  theoremName: string;
  /** Everything up to and including `:= by`. */
  header: string;
}

export interface Serialized {
  source: string;
  /** Where each step's tactic text starts. */
  steps: ReadonlyMap<StepId, SourcePos>;
  /** Where the visible `sorry` of a proof with no steps yet is; null otherwise. */
  placeholder: SourcePos | null;
  /** Line range of the declaration header, for errors that occur before any tactic. */
  headerLines: { start: number; end: number };
}

export class SerializeError extends Error {}

/** What an empty proof is written as, so Lean still reports the goal. Visible in the code pane. */
export const TODO = 'sorry';

const INDENT = 2;

/**
 * Turn a proof document into ordinary Lean: the header, then one tactic per
 * line. Every line of the output is something the player can see in the code
 * pane; nothing is added for instrumentation, because goal states come from
 * Lean's info trees.
 */
export function serialize(doc: ProofDocument, catalog: TacticCatalog, level: LevelSource): Serialized {
  const lines: string[] = [];
  const prelude = level.prelude.trimEnd();
  if (prelude) lines.push(...prelude.split('\n'), '');
  const headerStart = lines.length + 1;
  lines.push(...level.header.trimEnd().split('\n'));
  const headerEnd = lines.length;

  const pad = ' '.repeat(INDENT);
  const here = (): SourcePos => ({ line: lines.length + 1, col: INDENT });
  const steps = new Map<StepId, SourcePos>();
  let placeholder: SourcePos | null = null;

  if (doc.steps.length === 0) {
    placeholder = here();
    lines.push(pad + TODO);
  }
  for (const step of doc.steps) {
    if (!catalog.get(step.tactic)) throw new SerializeError(`step ${step.id} uses unknown tactic "${step.tactic}"`);
    const text = catalog.render(step.tactic, step.args);
    if (text === null) throw new SerializeError(`step ${step.id} has an empty required argument`);
    if (text.includes('\n')) throw new SerializeError(`step ${step.id} spans several lines`);
    steps.set(step.id, here());
    lines.push(pad + text);
  }

  return { source: lines.join('\n') + '\n', steps, placeholder, headerLines: { start: headerStart, end: headerEnd } };
}
