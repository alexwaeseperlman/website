import { walk } from '../core/document/edit';
import type { BranchId, InsertPoint, ProofDocument, StepId } from '../core/document/types';
import type { Evaluation, StepStatus } from '../core/evaluate/evaluate';
import { Lean } from './Lean';
import type { Serialized } from '../core/serializer/serialize';

interface LineInfo {
  text: string;
  step?: { id: StepId; branch: BranchId; index: number };
  todo?: BranchId;
}

interface Props {
  doc: ProofDocument;
  ser: Serialized;
  ev: Evaluation | null;
  stale: boolean;
  selection: InsertPoint;
  onSelect: (at: InsertPoint) => void;
}

/**
 * The proof as Lean source. Every line is real Lean that gets checked; the
 * only additions are the tap targets after each branch ("end" rows), which
 * are drawn as controls, not code.
 */
export function CodePane({ doc, ser, ev, stale, selection, onSelect }: Props) {
  const lines: LineInfo[] = ser.source.split('\n').map((text) => ({ text }));
  const ends = new Map<number, { branch: BranchId; index: number }>();

  walk(doc.root, (b) => {
    b.steps.forEach((s, index) => {
      const pos = ser.steps.get(s.id);
      if (pos) lines[pos.line - 1]!.step = { id: s.id, branch: b.id, index };
    });
    if (b.steps.length === 0) {
      const pos = ser.branches.get(b.id);
      if (pos) lines[pos.line - 1]!.todo = b.id;
      return;
    }
    const last = b.steps.at(-1)!;
    if (last.branches?.length) return;
    const pos = ser.steps.get(last.id);
    if (pos) ends.set(pos.line, { branch: b.id, index: b.steps.length });
  });

  const first = ser.headerLines.start - 1;
  const rows = lines.slice(first).filter((l, i, all) => !(i === all.length - 1 && l.text === ''));

  return (
    <div className={`code ${stale ? 'is-stale' : ''}`} role="list" aria-label="Lean proof">
      {rows.map((line, i) => {
        const lineNo = first + i + 1;
        const status: StepStatus | undefined = line.step ? ev?.steps.get(line.step.id)?.status : undefined;
        const selected =
          (line.step && selection.branch === line.step.branch && selection.index === line.step.index) ||
          (line.todo && selection.branch === line.todo && selection.index === 0);
        const end = ends.get(lineNo);
        const endSelected = end && selection.branch === end.branch && selection.index === end.index;
        const tappable = line.step || line.todo;
        return (
          <div key={lineNo}>
            <div
              role="listitem"
              className={[
                'code-line',
                tappable ? 'is-tappable' : '',
                status ? `is-${status}` : '',
                line.todo ? 'is-todo' : '',
                selected ? 'is-selected' : '',
              ].join(' ')}
              onClick={() => {
                if (line.step) onSelect({ branch: line.step.branch, index: line.step.index });
                else if (line.todo) onSelect({ branch: line.todo, index: 0 });
              }}
            >
              <span className="code-num" aria-hidden="true">
                {i + 1}
              </span>
              <code>{line.text ? <Lean text={line.text} /> : ' '}</code>
            </div>
            {end && (
              <button
                type="button"
                className={`code-end ${endSelected ? 'is-selected' : ''}`}
                style={{ marginLeft: `${indentOf(line.text)}ch` }}
                onClick={() => onSelect(end)}
                aria-label="Select the state after this step"
              >
                after this
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length + (text.trimStart().startsWith('· ') ? 2 : 0);
}
