import type { Course } from '../core/course/types';
import { unlockedLevels } from '../core/course/graph';
import { courseNodes } from '../core/course/nodes';

interface Props {
  course: Course;
  progress: Record<string, number>;
  readTutorials: ReadonlySet<string>;
  engineLabel: string;
  onOpen: (id: string) => void;
  onEngineSettings: () => void;
}

/** Chapters in order; inside each, every level with the tutorials that lead into it. */
export function MapScreen({ course, progress, readTutorials, engineLabel, onOpen, onEngineSettings }: Props) {
  const done = new Set(course.levels.filter((l) => progress[l.id] === l.revision).map((l) => l.id));
  const open = new Set(unlockedLevels(course, done));
  const nodes = courseNodes(course);
  const levelNumber = new Map(course.levels.map((l, i) => [l.id, i + 1]));

  return (
    <div className="map">
      <header className="map-head">
        <h1>Leandoku</h1>
        <p>Proofs you build by tapping, checked by real Lean.</p>
      </header>
      {course.chapters.map((chapter, ci) => {
        const inChapter = nodes.filter((n) => n.chapter.id === chapter.id);
        const levels = inChapter.filter((n) => n.kind === 'level');
        const finished = levels.filter((n) => n.kind === 'level' && done.has(n.level.id)).length;
        return (
          <section key={chapter.id} className="map-chapter">
            <h2 className="chapter">
              <span className="chapter-num">Chapter {ci + 1}</span>
              {chapter.title}
              <span className="chapter-count">
                {finished}/{levels.length}
              </span>
            </h2>
            <p className="chapter-blurb">{chapter.blurb}</p>
            <ol className="levels">
              {inChapter.map((n) => {
                if (n.kind === 'tutorial') {
                  const reachable = open.has(n.tutorial.before);
                  const read = readTutorials.has(n.tutorial.id);
                  return (
                    <li key={n.tutorial.id}>
                      <button
                        type="button"
                        className={`tutorial-card ${read ? 'is-read' : ''}`}
                        disabled={!reachable}
                        onClick={() => onOpen(n.tutorial.id)}
                      >
                        <span className="tutorial-mark" aria-hidden="true">
                          ¶
                        </span>
                        <span className="level-title">{n.tutorial.title}</span>
                        <span className="level-state">{read ? 'Read' : reachable ? 'New' : ''}</span>
                      </button>
                    </li>
                  );
                }
                const l = n.level;
                const state = done.has(l.id) ? 'done' : open.has(l.id) ? 'open' : 'locked';
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      className={`level-card is-${state}`}
                      disabled={state === 'locked'}
                      onClick={() => onOpen(l.id)}
                    >
                      <span className="level-num">{levelNumber.get(l.id)}</span>
                      <span className="level-title">{l.title}</span>
                      <span className="level-state">{state === 'done' ? '✓' : state === 'locked' ? '🔒' : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      <footer className="map-foot">
        <span>Lean: {engineLabel}</span>{' '}
        <button type="button" className="link" onClick={onEngineSettings}>
          About
        </button>
      </footer>
    </div>
  );
}
