import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultCatalog } from '../core/catalog/registry';
import type { SlotValue } from '../core/catalog/types';
import { levelSource } from '../core/course/environment';
import type { Course, Level } from '../core/course/types';
import { deleteStep, emptyDocument, insertStep, locateStep, makeStep } from '../core/document/edit';
import { History } from '../core/document/history';
import type { InsertPoint, ProofDocument, StepId } from '../core/document/types';
import { evaluate, type Evaluation } from '../core/evaluate/evaluate';
import { autoBranch, checkpointAt, firstOpenPoint, validSelection } from '../core/play/play';
import { checkPolicy } from '../core/policy/policy';
import { serialize, type Serialized } from '../core/serializer/serialize';
import type { Session } from '../session/session';
import { loadDraft, markComplete, saveDraft } from '../storage/storage';

export type EngineState =
  | { kind: 'offline' }
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'unavailable'; error: string };

export interface CheckedState {
  /** The document this result belongs to; may lag the current one while checking. */
  doc: ProofDocument;
  ser: Serialized;
  ev: Evaluation;
}

export function useProofGame(course: Course, level: Level, session: Session | null) {
  const catalog = useMemo(() => defaultCatalog(), []);
  const source = useMemo(() => levelSource(course, level, catalog), [course, level, catalog]);
  const history = useMemo(
    () => new History<ProofDocument>(loadDraft(level.id, level.revision) ?? emptyDocument()),
    [level],
  );
  const [doc, setDoc] = useState(history.value);
  const [selection, setSelection] = useState<InsertPoint>(() => firstOpenPoint(history.value, null));
  const [checked, setChecked] = useState<CheckedState | null>(null);
  const [engine, setEngine] = useState<EngineState>(session ? { kind: 'checking' } : { kind: 'offline' });
  const [saved, setSaved] = useState(true);
  const [retries, setRetries] = useState(0);
  const firstResult = useRef(true);
  // Set by addStep: once Lean answers, a finished goal hands over to the next one.
  const advance = useRef(false);

  // The source for the current document, recomputed even without an engine so
  // the code pane always shows exactly what would be checked.
  const current = useMemo(() => serialize(doc, catalog, source), [doc, catalog, source]);

  useEffect(() => {
    setSaved(saveDraft(level.id, level.revision, doc));
    if (!session) {
      setEngine({ kind: 'offline' });
      return;
    }
    let cancelled = false;
    setEngine({ kind: 'checking' });
    void session.check(current.source, source.theoremName).then((out) => {
      if (cancelled || out.kind === 'stale') return;
      if (out.kind === 'unavailable') {
        setEngine({ kind: 'unavailable', error: out.error });
        return;
      }
      const ev = evaluate(current, out.response);
      const fixed = autoBranch(doc, ev, catalog);
      if (fixed !== doc) {
        // Opening the branches Lean reported is part of the same action.
        history.replace(fixed);
        setDoc(fixed);
        setSelection(firstOpenPoint(fixed, null));
        return;
      }
      setChecked({ doc, ser: current, ev });
      setEngine({ kind: 'ready' });
      if (firstResult.current) {
        firstResult.current = false;
        setSelection(firstOpenPoint(doc, ev));
      } else if (advance.current) {
        setSelection((s) => {
          const cp = checkpointAt(doc, ev, s);
          return cp.goals?.length === 0 && !cp.split ? firstOpenPoint(doc, ev) : s;
        });
      }
      advance.current = false;
      if (ev.status === 'complete' && checkPolicy(doc, level.policy).length === 0) {
        markComplete(level.id, level.revision);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, current, session, source, catalog, history, level, retries]);

  const apply = useCallback(
    (next: ProofDocument, sel: InsertPoint) => {
      history.push(next);
      setDoc(next);
      setSelection(validSelection(next, sel));
    },
    [history],
  );

  const addStep = useCallback(
    (tactic: string, args: Record<string, SlotValue>) => {
      const step = makeStep(tactic, args);
      const next = insertStep(doc, selection, step);
      advance.current = true;
      apply(next, { branch: selection.branch, index: selection.index + 1 });
    },
    [doc, selection, apply],
  );

  const removeStep = useCallback(
    (id: StepId) => {
      const loc = locateStep(doc, id);
      if (!loc) return;
      apply(deleteStep(doc, id), { branch: loc.branch.id, index: loc.index });
    },
    [doc, apply],
  );

  const undo = useCallback(() => {
    const prev = history.undo();
    if (prev) {
      setDoc(prev);
      setSelection((s) => validSelection(prev, s));
    }
  }, [history]);

  const redo = useCallback(() => {
    const next = history.redo();
    if (next) {
      setDoc(next);
      setSelection((s) => validSelection(next, s));
    }
  }, [history]);

  const retry = useCallback(() => {
    session?.retry();
    setRetries((n) => n + 1);
  }, [session]);

  const reset = useCallback(() => apply(emptyDocument(), { branch: 'root', index: 0 }), [apply]);

  const upToDate = checked?.doc === doc;
  const complete = upToDate && checked.ev.status === 'complete' && checkPolicy(doc, level.policy).length === 0;

  return {
    catalog,
    source,
    doc,
    current,
    checked,
    upToDate,
    complete,
    engine,
    saved,
    selection,
    setSelection,
    addStep,
    removeStep,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    retry,
    reset,
  };
}
