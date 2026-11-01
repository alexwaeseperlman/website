import { useMemo, useState } from 'react';
import { factsFor } from '../core/course/facts';
import type { Course, Level } from '../core/course/types';
import { findBranch, walk } from '../core/document/edit';
import type { InsertPoint } from '../core/document/types';
import { checkpointAt } from '../core/play/play';
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
  nextLevel: Level | undefined;
  onBack: () => void;
  onOpen: (id: string) => void;
  onEngineSettings: () => void;
}

export function Workspace({ course, level, session, nextLevel, onBack, onOpen, onEngineSettings }: Props) {
  const game = useProofGame(course, level, session);
  const [showFacts, setShowFacts] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
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
        <h1 className="bar-title">{level.title}</h1>
        <button type="button" className="icon-button" onClick={game.undo} disabled={!game.canUndo} aria-label="Undo">
          ↶
        </button>
        <button type="button" className="icon-button" onClick={game.redo} disabled={!game.canRedo} aria-label="Redo">
          ↷
        </button>
      </header>

      <EngineBanner state={game.engine} onRetry={game.retry} onSettings={onEngineSettings} />

      {showIntro && (
        <section className="intro">
          <p>{level.intro}</p>
          <div className="intro-actions">
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
        <section className="proved" role="status">
          <strong>Proved.</strong> Lean accepted the whole proof, and it is now a fact you can use.
          {nextLevel && (
            <button type="button" className="primary" onClick={() => onOpen(nextLevel.id)}>
              Next: {nextLevel.title}
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
        <StatePane checkpoint={checkpoint} stale={stale && game.engine.kind === 'checking'} offline={offline} />
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
        onAdd={game.addStep}
      />

      {!game.saved && <p className="note">This browser is not saving drafts (storage is unavailable).</p>}

      {showFacts && (
        <FactsSheet facts={facts} definitions={course.definitions} onClose={() => setShowFacts(false)} />
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

function EngineBanner({
  state,
  onRetry,
  onSettings,
}: {
  state: ReturnType<typeof useProofGame>['engine'];
  onRetry: () => void;
  onSettings: () => void;
}) {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'checking':
      return <div className="banner banner-quiet">Lean is checking…</div>;
    case 'offline':
      return (
        <div className="banner">
          Lean does not run in the browser yet, so steps here are not checked.{' '}
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
