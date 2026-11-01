import type { ProofDocument } from '../core/document/types';

/**
 * Drafts and progress in localStorage, each tied to the level revision it was
 * made for. Storage can be missing or full (private browsing); every call
 * fails soft and reports whether it actually saved.
 */
const PREFIX = 'leandoku.v1.';

interface DraftEnvelope {
  levelRevision: number;
  doc: ProofDocument;
}

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(levelId: string, revision: number): ProofDocument | undefined {
  const d = read<DraftEnvelope>(`draft.${levelId}`);
  return d && d.levelRevision === revision ? d.doc : undefined;
}

export function saveDraft(levelId: string, revision: number, doc: ProofDocument): boolean {
  return write(`draft.${levelId}`, { levelRevision: revision, doc } satisfies DraftEnvelope);
}

/** Completed levels, as level id → the revision that was proved. */
export function loadProgress(): Record<string, number> {
  return read<Record<string, number>>('progress') ?? {};
}

export function markComplete(levelId: string, revision: number): boolean {
  return write('progress', { ...loadProgress(), [levelId]: revision });
}

export function loadSetting(key: string): string | undefined {
  return read<string>(`setting.${key}`);
}

export function saveSetting(key: string, value: string | undefined): void {
  if (value === undefined) {
    try {
      localStorage.removeItem(PREFIX + `setting.${key}`);
    } catch {
      // nothing to do
    }
  } else write(`setting.${key}`, value);
}
