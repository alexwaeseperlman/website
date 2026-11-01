import type { Course } from '../core/course/types';
import { unlockedLevels } from '../core/course/graph';

interface Props {
  course: Course;
  progress: Record<string, number>;
  engineLabel: string;
  onOpen: (id: string) => void;
  onEngineSettings: () => void;
}

export function MapScreen({ course, progress, engineLabel, onOpen, onEngineSettings }: Props) {
  const done = new Set(course.levels.filter((l) => progress[l.id] === l.revision).map((l) => l.id));
  const open = new Set(unlockedLevels(course, done));
  return (
    <div className="map">
      <header className="map-head">
        <h1>Leandoku</h1>
        <p>Proofs you build by tapping, checked by real Lean.</p>
      </header>
      <h2 className="chapter">{course.title}</h2>
      <ol className="levels">
        {course.levels.map((l, i) => {
          const state = done.has(l.id) ? 'done' : open.has(l.id) ? 'open' : 'locked';
          return (
            <li key={l.id}>
              <button
                type="button"
                className={`level-card is-${state}`}
                disabled={state === 'locked'}
                onClick={() => onOpen(l.id)}
              >
                <span className="level-num">{i + 1}</span>
                <span className="level-title">{l.title}</span>
                <span className="level-state">{state === 'done' ? '✓' : state === 'locked' ? '🔒' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <footer className="map-foot">
        <span>Lean: {engineLabel}</span>{' '}
        <button type="button" className="link" onClick={onEngineSettings}>
          About
        </button>
      </footer>
    </div>
  );
}
