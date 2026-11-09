import type { TacticCatalog } from '../catalog/registry';
import type { SlotValue } from '../catalog/types';
import type { InsertPoint, ProofDocument } from '../document/types';
import type { LevelSource, SourcePos } from '../serializer/serialize';
import type { CheckResponse, Goal } from '../../engine/protocol';

/** A step the player could add next, not yet in the proof. */
export interface Candidate {
  tactic: string;
  args: Readonly<Record<string, SlotValue>>;
}

export interface ProbeSource {
  source: string;
  /** Where each candidate's tactic starts, in the order given; null for one that is incomplete. */
  marks: (SourcePos | null)[];
}

/** What Lean made of one candidate. */
export type ProbeResult =
  /** Lean ran it; these are the goals it leaves. */
  | { kind: 'ok'; goals: Goal[] }
  /** Lean rejected it, with its message. */
  | { kind: 'error'; text: string }
  /** Lean never got to it. */
  | { kind: 'unknown' };

const INDENT = '  ';

/**
 * Lean source that tries each candidate as the next step at `at`: one
 * `example` per candidate, holding the statement, the steps before `at`,
 * then the candidate. The prelude is elaborated once for all of them.
 * Nothing here predicts what a tactic does; the answer is whatever Lean
 * reports for each candidate's line.
 */
export function probeSource(
  doc: ProofDocument,
  at: InsertPoint,
  candidates: readonly Candidate[],
  catalog: TacticCatalog,
  level: LevelSource,
): ProbeSource {
  const lines: string[] = [];
  const prelude = level.prelude.trimEnd();
  if (prelude) lines.push(...prelude.split('\n'), '');
  const header = asExample(level.header).trimEnd().split('\n');
  const before = doc.steps.slice(0, at).map((s) => catalog.render(s.tactic, s.args));
  const marks: (SourcePos | null)[] = [];
  for (const c of candidates) {
    const text = catalog.get(c.tactic) ? catalog.render(c.tactic, c.args) : null;
    if (text === null || text.includes('\n') || before.some((b) => b === null)) {
      marks.push(null);
      continue;
    }
    lines.push(...header, ...before.map((b) => INDENT + b));
    marks.push({ line: lines.length + 1, col: INDENT.length });
    lines.push(INDENT + text, '');
  }
  return { source: lines.join('\n') + '\n', marks };
}

/** The statement as an anonymous `example`, so many copies can share a file. */
export function asExample(header: string): string {
  return header.replace(/^(\s*)theorem\s+\S+/, '$1example');
}

/** Read each candidate's outcome from Lean's response to a probe source. */
export function readProbe(probe: ProbeSource, res: CheckResponse): ProbeResult[] {
  return probe.marks.map((mark): ProbeResult => {
    if (!mark) return { kind: 'unknown' };
    const error = res.messages.find(
      (m) => m.severity === 'error' && m.range.startLine === mark.line && !m.text.startsWith('unsolved goals'),
    );
    if (error) return { kind: 'error', text: error.text };
    const node = res.tactics.find((t) => t.range.startLine === mark.line && t.range.startCol === mark.col);
    return node ? { kind: 'ok', goals: node.goalsAfter } : { kind: 'unknown' };
  });
}
