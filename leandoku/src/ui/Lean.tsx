import { tokenize } from '../core/lean/highlight';

/** Lean text with syntax colours. Multi-line text is coloured line by line. */
export function Lean({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && '\n'}
          {tokenize(line).map((t, j) =>
            t.kind === 'plain' ? t.text : (
              <span key={j} className={`tok-${t.kind}`}>
                {t.text}
              </span>
            ),
          )}
        </span>
      ))}
    </>
  );
}
