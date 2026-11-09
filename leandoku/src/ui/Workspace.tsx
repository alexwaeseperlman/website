import { useEffect, useMemo, useRef, useState } from 'react';
import { factsFor } from '../core/course/facts';
import type { Course, Level } from '../core/course/types';
import { tutorialsBefore, type CourseNode } from '../core/course/nodes';
import type { InsertPoint, StepId } from '../core/document/types';
import { errorSummary, hasMoreThanSummary } from '../core/play/errors';
import { checkpointAt, hiddenNames } from '../core/play/play';
import type { StartupProgress } from '../engine/wasm-client';
import type { Session } from '../session/session';
import { CodePane } from './CodePane';
import { Composer } from './Composer';
import { FactsPanel } from './FactsPanel';
import { StatePane } from './StatePane';
import { Text } from './TutorialScreen';
import { useProofGame } from './useProofGame';

interface Props {
  course: Course;
  level: Level;
  session: Session | null;
  startup: StartupProgress | null;
  next: CourseNode | undefined;
  onBack: () => void;
  onOpen: (id: string) => void;
  onEngineSettings: () => void;
}

export function Workspace({ course, level, session, startup, next, onBack, onOpen, onEngineSettings }: Props) {
  const game = useProofGame(course, level, session);
  // Bring the result into view when the proof completes, clear of the
  // sticky top bar.
  const provedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (game.complete) provedRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [game.complete]);
  const [pick, setPick] = useState<{ name: string; n: number } | null>(null);
  const offer = (name: string) => setPick((p) => ({ name, n: (p?.n ?? 0) + 1 }));
  // Using a theorem from the list below the goals opens the editor above it.
  const useFact = (name: string) => {
    offer(name);
    document.querySelector('.composer')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const chapter = course.chapters.find((c) => c.id === level.chapter);
  // The intro matters when starting out; on a proof in progress it is just in the way.
  const [showIntro, setShowIntro] = useState(() => game.doc.steps.length === 0);
  const facts = useMemo(() => factsFor(course, level), [course, level]);
  // Hints come one at a time, and only when asked for.
  const hints = level.hints ?? [];
  const [hintsShown, setHintsShown] = useState(0);
  const moreHints = hintsShown < hints.length;
  const showHint = () => {
    setHintsShown((n) => Math.min(n + 1, hints.length));
    setShowIntro(true);
  };
  const hintButton = moreHints && (
    <button type="button" className="link" onClick={showHint}>
      {hintsShown === 0 ? 'Hint' : `Next hint (${hintsShown}/${hints.length})`}
    </button>
  );
  const [editingId, setEditingId] = useState<StepId | null>(null);
  const showFacts = () => document.getElementById('facts')?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const ev = game.checked?.ev ?? null;
  const stale = !game.upToDate;
  const checkpoint = checkpointAt(game.doc, ev, game.selection);
  const selectedStep = checkpoint.next;
  const stepResult = selectedStep ? ev?.steps.get(selectedStep.id) : undefined;
  const offline = game.engine.kind === 'offline';
  const rejected = stepResult?.status === 'error';
  // Editing follows the selection: choosing another step ends it.
  const editing = selectedStep && selectedStep.id === editingId ? selectedStep : null;

  const goal = checkpoint.goals?.[0] ?? null;
  const previewReady = game.upToDate && game.engine.kind === 'ready';

  return (
    <div className="workspace">
      <header className="bar">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back to levels">
          ←
        </button>
        <h1 className="bar-title">
          {chapter && <span className="bar-kicker">{chapter.title}</span>}
          {level.title}
        </h1>
        <button type="button" className="icon-button" onClick={game.undo} disabled={!game.canUndo} aria-label="Undo">
          ↶
        </button>
        <button type="button" className="icon-button" onClick={game.redo} disabled={!game.canRedo} aria-label="Redo">
          ↷
        </button>
      </header>

      <EngineBanner state={game.engine} startup={startup} onRetry={game.retry} onSettings={onEngineSettings} />

      {showIntro && (
        <section className="intro">
          <p>
            <Text text={level.intro} />
          </p>
          {hintsShown > 0 && (
            <ol className="hints">
              {hints.slice(0, hintsShown).map((h, i) => (
                <li key={i}>
                  <Text text={h} />
                </li>
              ))}
            </ol>
          )}
          <div className="intro-actions">
            {hintButton}
            {tutorialsBefore(course, level.id).map((t) => (
              <button key={t.id} type="button" className="link" onClick={() => onOpen(t.id)}>
                {t.title}
              </button>
            ))}
            <button type="button" className="link" onClick={showFacts}>
              Theorems and definitions
            </button>
            <button type="button" className="link" onClick={() => setShowIntro(false)}>
              Hide
            </button>
          </div>
        </section>
      )}
      {!showIntro && (
        <div className="intro-collapsed">
          <button type="button" className="link" onClick={() => setShowIntro(true)}>
            Show intro
          </button>
          {hintButton}
          <button type="button" className="link" onClick={showFacts}>
            Theorems and definitions
          </button>
        </div>
      )}

      {game.complete && (
        <section className="proved" role="status" ref={provedRef}>
          <strong>Proved.</strong> Lean accepted the whole proof, and it is now a fact you can use.
          {next && (
            <button
              type="button"
              className="primary"
              onClick={() => onOpen(next.kind === 'level' ? next.level.id : next.tutorial.id)}
            >
              Next: {next.kind === 'level' ? next.level.title : next.tutorial.title}
            </button>
          )}
        </section>
      )}

      <CodePane
        doc={game.doc}
        ser={game.current}
        ev={ev}
        stale={stale}
        selection={game.selection}
        onSelect={game.setSelection}
      />

      <Composer
        catalog={game.catalog}
        policy={level.policy}
        goals={checkpoint.goals}
        facts={facts}
        definitions={course.definitions}
        pick={pick}
        renameNames={hiddenNames(goal)}
        editing={editing}
        preview={{ session, level: game.source, doc: game.doc, at: game.selection, ready: previewReady }}
        onAdd={game.addStep}
        onReplace={(step, tactic, args) => game.replaceStep(step.id, tactic, args)}
        onStopEditing={() => setEditingId(null)}
      />

      <section className="panel">
        <div className="panel-head">
          <span>
            {rejected ? 'Before the rejected step' : selectedStep ? 'Before the selected step' : 'Proof state'}
          </span>
          {selectedStep && (
            <span className="panel-actions">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEditingId(selectedStep.id);
                  document.querySelector('.composer')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }}
              >
                Change
              </button>
              <button type="button" className="link danger" onClick={() => game.removeStep(selectedStep.id)}>
                  Delete
              </button>
            </span>
          )}
        </div>
        <StatePane
          checkpoint={checkpoint}
          stale={stale && game.engine.kind === 'checking'}
          offline={offline}
          onPick={offer}
        />
        {checkpoint.goals === null && !stepResult?.errors.length && ev && (
          <FirstError ev={ev} doc={game.doc} onSelect={game.setSelection} />
        )}
        {stepResult?.errors.map((e, i) => <ErrorNote key={i} text={e.text} />)}
        {ev?.headerErrors.map((e, i) => <ErrorNote key={i} text={`The statement itself has an error: ${e.text}`} />)}
      </section>

      <FactsPanel facts={facts} definitions={course.definitions} onUse={useFact} />

      {!game.saved && <p className="note">This browser is not saving drafts (storage is unavailable).</p>}
    </div>
  );
}

/** When the selected point was never reached, point at the step that stopped Lean. */
function FirstError({
  ev,
  doc,
  onSelect,
}: {
  ev: NonNullable<ReturnType<typeof useProofGame>['checked']>['ev'];
  doc: ReturnType<typeof useProofGame>['doc'];
  onSelect: (at: InsertPoint) => void;
}) {
  const at = doc.steps.findIndex((s) => ev.steps.get(s.id)?.status === 'error');
  if (at < 0) return null;
  const text = ev.steps.get(doc.steps[at]!.id)!.errors[0]?.text ?? '';
  return (
    <>
      <ErrorNote text={text} />
      <button type="button" className="link" onClick={() => onSelect(at)}>
        Show the state before that step
      </button>
    </>
  );
}

/**
 * A Lean error, shortest useful form first: what went wrong on one line.
 * The rest (Lean repeats the goal it was on) is a tap away.
 */
function ErrorNote({ text }: { text: string }) {
  return (
    <div className="error">
      <p className="error-summary">{errorSummary(text)}</p>
      {hasMoreThanSummary(text) && (
        <details>
          <summary>Lean's full message</summary>
          <pre>{text}</pre>
        </details>
      )}
    </div>
  );
}

const STAGE_LABEL: Record<StartupProgress['stage'], string> = {
  'download-runtime': 'Downloading Lean',
  'download-library': 'Downloading the Lean library',
  'load-library': 'Unpacking the library',
  'start-lean': 'Starting Lean',
  'warm-up': 'Getting Lean up to speed',
};

function mb(n: number): string {
  return (n / 1e6).toFixed(n < 10e6 ? 1 : 0);
}

function startupText(p: StartupProgress): string {
  const label = STAGE_LABEL[p.stage];
  if (p.loaded === undefined) return `${label}…`;
  return p.total ? `${label}: ${mb(p.loaded)} of ${mb(p.total)} MB` : `${label}: ${mb(p.loaded)} MB`;
}

function EngineBanner({
  state,
  startup,
  onRetry,
  onSettings,
}: {
  state: ReturnType<typeof useProofGame>['engine'];
  startup: StartupProgress | null;
  onRetry: () => void;
  onSettings: () => void;
}) {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'checking':
      if (startup) {
        return (
          <div className="banner banner-quiet" role="status">
            {startupText(startup)}
            {startup.loaded !== undefined && startup.total ? (
              <progress value={startup.loaded} max={startup.total} />
            ) : null}
            <div className="banner-note">This happens once; your browser keeps Lean for next time.</div>
          </div>
        );
      }
      return <div className="banner banner-quiet">Lean is checking…</div>;
    case 'offline':
      return (
        <div className="banner">
          Lean is not available on this page, so steps here are not checked.{' '}
          <button type="button" className="link" onClick={onSettings}>
            Why, and how to play now
          </button>
        </div>
      );
    case 'unavailable':
      return (
        <div className="banner banner-error">
          Lean is not responding. Your proof is saved.{' '}
          <button type="button" className="link" onClick={onRetry}>
            Retry
          </button>{' '}
          <button type="button" className="link" onClick={onSettings}>
            About the engine
          </button>
          <details>
            <summary>Details</summary>
            <code>{state.error}</code>
          </details>
        </div>
      );
  }
}
