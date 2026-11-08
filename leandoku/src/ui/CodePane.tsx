import type { InsertPoint, ProofDocument, StepId } from '../core/document/types';
import type { Evaluation, StepStatus } from '../core/evaluate/evaluate';
import { Lean } from './Lean';
import type { Serialized } from '../core/serializer/serialize';

interface LineInfo {
  text: string;
  step?: { id: StepId; index: number };
  placeholder?: boolean;
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
 * only addition is the tap target after the last step (the "end" row),
 * which is drawn as a control, not code.
 */
export function CodePane({ doc, ser, ev, stale, selection, onSelect }: Props) {
  const lines: LineInfo[] = ser.source.split('\n').map((text) => ({ text }));
  doc.steps.forEach((s, index) => {
    const pos = ser.steps.get(s.id);
    if (pos) lines[pos.line - 1]!.step = { id: s.id, index };
  });
  if (ser.placeholder) lines[ser.placeholder.line - 1]!.placeholder = true;
  const lastPos = doc.steps.length ? ser.steps.get(doc.steps.at(-1)!.id) : undefined;
  const end = doc.steps.length;

  const first = ser.headerLines.start - 1;
  const rows = lines.slice(first).filter((l, i, all) => !(i === all.length - 1 && l.text === ''));

  return (
    <div className={`code ${stale ? 'is-stale' : ''}`} role="list" aria-label="Lean proof">
      {rows.map((line, i) => {
        const lineNo = first + i + 1;
        const status: StepStatus | undefined = line.step ? ev?.steps.get(line.step.id)?.status : undefined;
        const selected = (line.step && selection === line.step.index) || (line.placeholder && selection === 0);
        const tappable = line.step || line.placeholder;
        return (
          <div key={lineNo}>
            <div
              role="listitem"
              className={[
                'code-line',
                tappable ? 'is-tappable' : '',
                status ? `is-${status}` : '',
                line.placeholder ? 'is-todo' : '',
                selected ? 'is-selected' : '',
              ].join(' ')}
              onClick={() => {
                if (line.step) onSelect(line.step.index);
                else if (line.placeholder) onSelect(0);
              }}
            >
              <span className="code-num" aria-hidden="true">
                {i + 1}
              </span>
              <code>{line.text ? <Lean text={line.text} /> : ' '}</code>
            </div>
            {lastPos?.line === lineNo && (
              <button
                type="button"
                className={`code-end ${selection === end ? 'is-selected' : ''}`}
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
  return text.length - text.trimStart().length;
}
