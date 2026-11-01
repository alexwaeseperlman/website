import type { IdSource } from '../src/core/document/edit';

/** Deterministic ids: s1, s2, ... */
export function counterIds(prefix = 's'): IdSource {
  let n = 0;
  return () => `${prefix}${++n}`;
}
