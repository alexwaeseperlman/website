import { useEffect } from 'react';
import type { CourseNode } from '../core/course/nodes';
import type { Chapter, Definition, Tutorial } from '../core/course/types';
import { Lean } from './Lean';
import { markTutorialRead } from '../storage/storage';

interface Props {
  tutorial: Tutorial;
  chapter: Chapter;
  definitions: Definition[];
  next: CourseNode | undefined;
  onBack: () => void;
  onOpen: (id: string) => void;
}

/** Inline `code` in tutorial text, the only markup tutorials use. */
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
      )}
    </>
  );
}

export function TutorialScreen({ tutorial, chapter, definitions, next, onBack, onOpen }: Props) {
  // Reaching the page counts as reading it; a tutorial never blocks a level.
  useEffect(() => markTutorialRead(tutorial.id), [tutorial.id]);
  const shown = (tutorial.definitions ?? []).map((n) => definitions.find((d) => d.name === n)).filter((d) => d !== undefined);

  return (
    <div className="tutorial">
      <header className="bar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back to levels">
          ←
        </button>
        <div className="bar-title">
          <span className="bar-kicker">{chapter.title}</span>
          {tutorial.title}
        </div>
      </header>

      <article className="tutorial-body">
        <h1>{tutorial.title}</h1>
        {tutorial.blocks.map((b, i) =>
          'code' in b ? (
            <pre key={i} className="tutorial-code">
              <Lean text={b.code} />
            </pre>
          ) : 'aside' in b ? (
            <p key={i} className="tutorial-aside">
              <Text text={b.aside} />
            </p>
          ) : (
            <p key={i}>
              <Text text={b.text} />
            </p>
          ),
        )}
        {shown.map((d) => (
          <div key={d.name} className="fact">
            <div className="fact-name">{d.name}</div>
            <pre className="fact-source">{d.source}</pre>
          </div>
        ))}
      </article>

      <footer className="tutorial-foot">
        {next ? (
          <button type="button" className="primary" onClick={() => onOpen(next.kind === 'level' ? next.level.id : next.tutorial.id)}>
            {next.kind === 'level' ? `Start: ${next.level.title}` : `Next: ${next.tutorial.title}`}
          </button>
        ) : (
          <button type="button" className="primary" onClick={onBack}>
            Back to levels
          </button>
        )}
      </footer>
    </div>
  );
}
