import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultCatalog } from '../core/catalog/registry';
import type { SlotValue } from '../core/catalog/types';
import { levelSource } from '../core/course/environment';
import type { Course, Level } from '../core/course/types';
import { deleteStep, emptyDocument, indexOfStep, insertStep, makeStep, validInsertPoint } from '../core/document/edit';
import { History } from '../core/document/history';
import type { InsertPoint, ProofDocument, StepId } from '../core/document/types';
import { evaluate, type Evaluation } from '../core/evaluate/evaluate';
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
  // The insertion point; it starts at the end of the proof.
  const [selection, setSelection] = useState<InsertPoint>(() => history.value.steps.length);
  const [checked, setChecked] = useState<CheckedState | null>(null);
  const [engine, setEngine] = useState<EngineState>(session ? { kind: 'checking' } : { kind: 'offline' });
  const [saved, setSaved] = useState(true);
  const [retries, setRetries] = useState(0);

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
      setChecked({ doc, ser: current, ev });
      setEngine({ kind: 'ready' });
      if (ev.status === 'complete' && checkPolicy(doc, level.policy).length === 0) {
        markComplete(level.id, level.revision);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, current, session, source, level, retries]);

  const apply = useCallback(
    (next: ProofDocument, sel: InsertPoint) => {
      history.push(next);
      setDoc(next);
      setSelection(validInsertPoint(next, sel));
    },
    [history],
  );

  const addStep = useCallback(
    (tactic: string, args: Record<string, SlotValue>) => {
      const step = makeStep(tactic, args);
      apply(insertStep(doc, selection, step), selection + 1);
    },
    [doc, selection, apply],
  );

  const removeStep = useCallback(
    (id: StepId) => {
      const index = indexOfStep(doc, id);
      if (index < 0) return;
      apply(deleteStep(doc, id), index);
    },
    [doc, apply],
  );

  const undo = useCallback(() => {
    const prev = history.undo();
    if (prev) {
      setDoc(prev);
      setSelection((s) => validInsertPoint(prev, s));
    }
  }, [history]);

  const redo = useCallback(() => {
    const next = history.redo();
    if (next) {
      setDoc(next);
      setSelection((s) => validInsertPoint(next, s));
    }
  }, [history]);

  const retry = useCallback(() => {
    session?.retry();
    setRetries((n) => n + 1);
  }, [session]);

  const reset = useCallback(() => apply(emptyDocument(), 0), [apply]);

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
