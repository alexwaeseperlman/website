import { useEffect, useMemo, useState } from 'react';
import type { TacticCatalog } from '../core/catalog/registry';
import type { InsertPoint, ProofDocument } from '../core/document/types';
import { probeSource, readProbe, type Candidate, type ProbeResult } from '../core/play/probe';
import type { LevelSource } from '../core/serializer/serialize';
import type { Session } from '../session/session';

interface Args {
  session: Session | null;
  catalog: TacticCatalog;
  level: LevelSource;
  doc: ProofDocument;
  /** The candidates would go in before step `at`. */
  at: InsertPoint;
  candidates: readonly Candidate[];
  /** Off while the proof itself is being checked, or when Lean has no state here. */
  enabled: boolean;
}

/**
 * What Lean says each candidate step would do, in the candidates' order.
 * An entry is `undefined` until Lean has answered for the current list.
 */
export function useProbe({ session, catalog, level, doc, at, candidates, enabled }: Args): (ProbeResult | undefined)[] {
  const probe = useMemo(
    () => (enabled && session && candidates.length > 0 ? probeSource(doc, at, candidates, catalog, level) : null),
    [enabled, session, doc, at, candidates, catalog, level],
  );
  const [answer, setAnswer] = useState<{ source: string; results: ProbeResult[] } | null>(null);

  useEffect(() => {
    if (!probe || !session || probe.marks.every((m) => m === null)) return;
    let cancelled = false;
    // Wait for typing and tapping to settle; each probe is a real Lean run.
    const timer = setTimeout(() => {
      void session.probe(probe.source).then((res) => {
        if (!cancelled && res) setAnswer({ source: probe.source, results: readProbe(probe, res) });
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [probe, session]);

  if (!probe || answer?.source !== probe.source) return candidates.map(() => undefined);
  return answer.results;
}
