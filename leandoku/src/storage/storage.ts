import type { ProofDocument, Step } from '../core/document/types';

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
  if (!d || d.levelRevision !== revision) return undefined;
  if (Array.isArray(d.doc?.steps)) return d.doc;
  const old = d.doc as unknown as OldDocument;
  return old?.root ? { revision: old.revision ?? 0, steps: flattenOld(old.root) } : undefined;
}

/**
 * Drafts saved before the proof was a plain tactic sequence held a tree:
 * each case of a split was a branch, written as a bullet or a `with` arm.
 * Read in Lean's goal order, that tree is the same sequence, with a
 * rename_i wherever an arm named its variables.
 */
interface OldBranch {
  id: string;
  names?: string[];
  steps: (Step & { branches?: OldBranch[] })[];
}
interface OldDocument {
  revision?: number;
  root?: OldBranch;
}

function flattenOld(branch: OldBranch): Step[] {
  return branch.steps.flatMap(({ branches, ...step }) => [
    step,
    ...(branches ?? []).flatMap((b) => [
      ...(b.names?.length ? [{ id: `${b.id}-names`, tactic: 'rename_i', args: { names: { kind: 'names' as const, names: b.names } } }] : []),
      ...flattenOld(b),
    ]),
  ]);
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

/** Tutorials the player has read, by id. */
export function loadReadTutorials(): Set<string> {
  return new Set(read<string[]>('tutorials.read') ?? []);
}

export function markTutorialRead(id: string): void {
  const done = loadReadTutorials();
  if (!done.has(id)) write('tutorials.read', [...done, id]);
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
