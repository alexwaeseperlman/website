import type { BranchId, StepId } from '../document/types';
import type { Serialized, SourcePos } from '../serializer/serialize';
import type { CheckResponse, Goal, Message, TacticStep } from '../../engine/protocol';

export type StepStatus =
  /** Lean ran the tactic without error. */
  | 'ok'
  /** Lean reported an error on this tactic. */
  | 'error'
  /** Lean never reached the tactic (an earlier failure, or a header error). */
  | 'blocked';

export interface StepResult {
  status: StepStatus;
  /** The checkpoint before the step: what the player sees when selecting it. */
  goalsBefore: Goal[];
  /** Present only when the step ran. */
  goalsAfter: Goal[] | null;
  errors: Message[];
}

export interface BranchResult {
  /** The goal this branch proves, as Lean stated it; null if never reached. */
  goal: Goal | null;
}

export type ProofStatus = 'complete' | 'incomplete' | 'rejected';

export interface Evaluation {
  status: ProofStatus;
  steps: ReadonlyMap<StepId, StepResult>;
  branches: ReadonlyMap<BranchId, BranchResult>;
  /** Errors in the statement itself; when present, no tactic can help. */
  headerErrors: Message[];
  /** Goals Lean says remain open, with where it reported them. */
  unsolved: Message[];
  /** Errors not attributable to a step or the header. */
  otherErrors: Message[];
}

/** Axioms a completed proof may depend on. `sorryAx` is never among them. */
export const STANDARD_AXIOMS: readonly string[] = ['propext', 'Classical.choice', 'Quot.sound'];

/** Bullet tokens report the focused goal; the step itself is the node after them. */
const SKIPPED_KINDS = new Set(['Lean.cdot', 'Lean.cdotTk']);

function nodeAt(tactics: readonly TacticStep[], pos: SourcePos): TacticStep | undefined {
  return tactics.find(
    (t) => t.range.startLine === pos.line && t.range.startCol === pos.col && !SKIPPED_KINDS.has(t.kind),
  );
}

const isUnsolved = (m: Message): boolean => m.text.startsWith('unsolved goals');

/**
 * Combine the document, its source map and Lean's response into what the UI
 * shows. All mathematical facts here come from the response; this function
 * only decides which Lean result belongs to which visible step.
 */
export function evaluate(
  ser: Serialized,
  res: CheckResponse,
  allowedAxioms: readonly string[] = STANDARD_AXIOMS,
): Evaluation {
  const errors = res.messages.filter((m) => m.severity === 'error');
  const headerErrors = errors.filter(
    (m) => m.range.startLine >= ser.headerLines.start && m.range.startLine <= ser.headerLines.end && !isUnsolved(m),
  );
  const unsolved = errors.filter(isUnsolved);
  const claimed = new Set<Message>([...headerErrors, ...unsolved]);

  const steps = new Map<StepId, StepResult>();
  for (const [id, pos] of ser.steps) {
    const node = nodeAt(res.tactics, pos);
    const own = errors.filter((m) => !claimed.has(m) && m.range.startLine === pos.line && m.range.startCol >= pos.col);
    own.forEach((m) => claimed.add(m));
    steps.set(id, {
      status: own.length > 0 ? 'error' : node ? 'ok' : 'blocked',
      goalsBefore: node?.goalsBefore ?? [],
      goalsAfter: node && own.length === 0 ? node.goalsAfter : null,
      errors: own,
    });
  }

  const branches = new Map<BranchId, BranchResult>();
  for (const [id, pos] of ser.branches) {
    branches.set(id, { goal: nodeAt(res.tactics, pos)?.goalsBefore[0] ?? null });
  }

  const otherErrors = errors.filter((m) => !claimed.has(m));
  const anyStepError = [...steps.values()].some((s) => s.status === 'error');
  const rejected = headerErrors.length > 0 || anyStepError || otherErrors.length > 0;

  const c = res.completion;
  const closed =
    !rejected &&
    unsolved.length === 0 &&
    c !== undefined &&
    c.exists_ &&
    c.axioms.every((a) => allowedAxioms.includes(a)) &&
    ![...steps.values()].some((s) => s.status !== 'ok');

  return {
    status: rejected ? 'rejected' : closed ? 'complete' : 'incomplete',
    steps,
    branches,
    headerErrors,
    unsolved,
    otherErrors,
  };
}
