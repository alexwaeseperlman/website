import type { TacticCatalog } from '../catalog/registry';
import type { Branch, BranchId, ProofDocument, StepId } from '../document/types';

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
  /**
   * Where each branch's first line starts: its first step, or the visible
   * `sorry` placeholder of a branch with no steps yet.
   */
  branches: ReadonlyMap<BranchId, SourcePos>;
  /** Line range of the declaration header, for errors that occur before any tactic. */
  headerLines: { start: number; end: number };
}

export class SerializeError extends Error {}

/** The placeholder for a branch the player has not started. Visible in the code pane. */
export const TODO = 'sorry';

/**
 * Turn a proof document into ordinary Lean. Every line of the output is
 * something the player can see in the code pane; nothing is added for
 * instrumentation, because goal states come from Lean's info trees.
 */
export function serialize(doc: ProofDocument, catalog: TacticCatalog, level: LevelSource): Serialized {
  const lines: string[] = [];
  const prelude = level.prelude.trimEnd();
  if (prelude) lines.push(...prelude.split('\n'), '');
  const headerStart = lines.length + 1;
  lines.push(...level.header.trimEnd().split('\n'));
  const headerEnd = lines.length;

  const steps = new Map<StepId, SourcePos>();
  const branches = new Map<BranchId, SourcePos>();

  /**
   * Emit a branch's steps. `lead` is written before the first line (a bullet
   * `· `), and `indent` is the column of every step.
   */
  const emitBranch = (branch: Branch, indent: number, lead: string): void => {
    const pad = ' '.repeat(indent);
    let first = true;
    const startLine = (): string => {
      const prefix = first ? ' '.repeat(indent - lead.length) + lead : pad;
      first = false;
      return prefix;
    };
    const here = (): SourcePos => ({ line: lines.length + 1, col: indent });

    if (branch.steps.length === 0) {
      branches.set(branch.id, here());
      lines.push(startLine() + TODO);
      return;
    }
    branch.steps.forEach((step, i) => {
      const spec = catalog.get(step.tactic);
      if (!spec) throw new SerializeError(`step ${step.id} uses unknown tactic "${step.tactic}"`);
      const text = catalog.render(step.tactic, step.args);
      if (text === null) throw new SerializeError(`step ${step.id} has an empty required argument`);
      if (text.includes('\n')) throw new SerializeError(`step ${step.id} spans several lines`);
      const pos = here();
      if (i === 0) branches.set(branch.id, pos);
      steps.set(step.id, pos);

      const children = step.branches ?? [];
      const useAlternatives = spec.branchStyle === 'alternatives' && children.length > 0 && children.every((b) => b.tag);
      lines.push(startLine() + text + (useAlternatives ? ' with' : ''));
      for (const child of children) {
        if (useAlternatives) {
          const binders = [child.tag, ...child.names].join(' ');
          lines.push(`${pad}| ${binders} =>`);
          emitBranch(child, indent + 4, '');
        } else {
          emitBranch(child, indent + 2, '· ');
        }
      }
    });
  };

  emitBranch(doc.root, 2, '');
  return { source: lines.join('\n') + '\n', steps, branches, headerLines: { start: headerStart, end: headerEnd } };
}
