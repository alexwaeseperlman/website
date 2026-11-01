import { useEffect, useMemo, useRef, useState } from 'react';
import { factsFor } from '../core/course/facts';
import type { Course, Level } from '../core/course/types';
import { tutorialsBefore, type CourseNode } from '../core/course/nodes';
import { findBranch, walk } from '../core/document/edit';
import type { InsertPoint } from '../core/document/types';
import { checkpointAt } from '../core/play/play';
import type { StartupProgress } from '../engine/wasm-client';
import type { Session } from '../session/session';
import { CodePane } from './CodePane';
import { Composer } from './Composer';
import { FactsSheet } from './FactsSheet';
import { StatePane } from './StatePane';
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
  // The last step is usually added far down the page, so bring the result
  // into view when the proof completes, clear of the sticky top bar.
  const provedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (game.complete) provedRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [game.complete]);
  const [showFacts, setShowFacts] = useState(false);
  const [pick, setPick] = useState<{ name: string; n: number } | null>(null);
  const offer = (name: string) => setPick((p) => ({ name, n: (p?.n ?? 0) + 1 }));
  const chapter = course.chapters.find((c) => c.id === level.chapter);
  // The intro matters when starting out; on a proof in progress it is just in the way.
  const [showIntro, setShowIntro] = useState(() => game.doc.root.steps.length === 0);
  const facts = useMemo(() => factsFor(course, level), [course, level]);

  const ev = game.checked?.ev ?? null;
  const stale = !game.upToDate;
  const checkpoint = checkpointAt(game.doc, ev, game.selection);
  const branch = findBranch(game.doc, game.selection.branch);
  const selectedStep = checkpoint.next;
  const stepResult = selectedStep ? ev?.steps.get(selectedStep.id) : undefined;
  const offline = game.engine.kind === 'offline';

  const addBlocked = checkpoint.split ? 'This step split the goal; add steps inside one of its cases.' : null;

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
          <p>{level.intro}</p>
          <div className="intro-actions">
            {tutorialsBefore(course, level.id).map((t) => (
              <button key={t.id} type="button" className="link" onClick={() => onOpen(t.id)}>
                {t.title}
              </button>
            ))}
            <button type="button" className="link" onClick={() => setShowFacts(true)}>
              Definitions and facts
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
          <button type="button" className="link" onClick={() => setShowFacts(true)}>
            Definitions and facts
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

      <section className="panel">
        <div className="panel-head">
          <span>
            {selectedStep ? 'Before the selected step' : branch?.tag ? `Case ${branch.tag}` : 'Proof state'}
          </span>
          {selectedStep && (
            <button type="button" className="link danger" onClick={() => game.removeStep(selectedStep.id)}>
              Delete step
            </button>
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
        {stepResult?.errors.map((e, i) => (
          <pre key={i} className="error">
            {e.text}
          </pre>
        ))}
        {ev?.headerErrors.map((e, i) => (
          <pre key={i} className="error">
            The statement itself has an error: {e.text}
          </pre>
        ))}
      </section>

      <Composer
        catalog={game.catalog}
        policy={level.policy}
        goal={checkpoint.goals?.[0] ?? null}
        facts={facts}
        definitions={course.definitions}
        disabled={addBlocked}
        pick={pick}
        onAdd={game.addStep}
      />

      {!game.saved && <p className="note">This browser is not saving drafts (storage is unavailable).</p>}

      {showFacts && (
        <FactsSheet
          facts={facts}
          definitions={course.definitions}
          onClose={() => setShowFacts(false)}
          onUse={(name) => {
            setShowFacts(false);
            offer(name);
          }}
        />
      )}
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
  let found: { at: InsertPoint; text: string } | null = null;
  walk(doc.root, (b) => {
    b.steps.forEach((s, index) => {
      const r = ev.steps.get(s.id);
      if (!found && r?.status === 'error') found = { at: { branch: b.id, index }, text: r.errors[0]?.text ?? '' };
    });
  });
  if (!found) return null;
  const { at, text } = found;
  return (
    <>
      <pre className="error">{text}</pre>
      <button type="button" className="link" onClick={() => onSelect(at)}>
        Show the state before that step
      </button>
    </>
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
