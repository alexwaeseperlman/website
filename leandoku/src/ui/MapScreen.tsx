import { useState } from 'react';
import type { Course } from '../core/course/types';
import { unlockedLevels } from '../core/course/graph';
import { courseNodes } from '../core/course/nodes';
import { loadSetting } from '../storage/storage';

interface Props {
  course: Course;
  progress: Record<string, number>;
  readTutorials: ReadonlySet<string>;
  engineLabel: string;
  onOpen: (id: string) => void;
  onEngineSettings: () => void;
}

/**
 * Chapters in order; inside each, every level with the tutorials that lead
 * into it. Only one chapter starts open, the one the player is in, so the
 * map fits a phone screen; the rest open with a tap.
 */
export function MapScreen({ course, progress, readTutorials, engineLabel, onOpen, onEngineSettings }: Props) {
  const done = new Set(course.levels.filter((l) => progress[l.id] === l.revision).map((l) => l.id));
  const open = new Set(unlockedLevels(course, done));
  const nodes = courseNodes(course);
  const levelNumber = new Map(course.levels.map((l, i) => [l.id, i + 1]));
  // The chapter last played, or else the first with something left to prove.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const last = course.levels.find((l) => l.id === loadSetting('last-level'));
    const current = last ?? course.levels.find((l) => !done.has(l.id)) ?? course.levels[0];
    return new Set(current ? [current.chapter] : []);
  });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
        const isOpen = expanded.has(chapter.id);
        return (
          <section key={chapter.id} className={`map-chapter ${isOpen ? 'is-open' : ''}`}>
            <h2 className="chapter">
              <button type="button" className="chapter-toggle" aria-expanded={isOpen} onClick={() => toggle(chapter.id)}>
                <span className="chapter-num">Chapter {ci + 1}</span>
                <span className="chapter-title">{chapter.title}</span>
                <span className="chapter-count">
                  {finished === levels.length ? '✓ ' : ''}
                  {finished}/{levels.length}
                </span>
                <span className="chapter-chevron" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
            </h2>
            {isOpen && <p className="chapter-blurb">{chapter.blurb}</p>}
            {isOpen && (
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
            )}
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
