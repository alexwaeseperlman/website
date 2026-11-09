import { EngineUnavailableError, type Engine } from '../engine/engine';
import { PROTOCOL_VERSION, type CheckResponse } from '../engine/protocol';
import { ByteLru } from './lru';

export type CheckOutcome =
  | { kind: 'result'; generation: number; response: CheckResponse }
  /** A newer check was submitted before this one finished; show nothing from it. */
  | { kind: 'stale'; generation: number }
  /** The runtime failed. The draft is untouched; `retry()` starts a fresh engine. */
  | { kind: 'unavailable'; generation: number; error: string };

export interface SessionOptions {
  createEngine: () => Engine;
  cacheBytes?: number;
}

/**
 * Owns the engine's lifetime and the order of results. Views come and go;
 * the session (and its engine) stays. A result is delivered only if no newer
 * check has been submitted since, so a slow answer can never overwrite the
 * player's latest edit.
 */
export class Session {
  private engine: Engine | null = null;
  private generation = 0;
  private nextRequest = 0;
  private probesOff = false;
  private readonly cache: ByteLru<CheckResponse>;

  constructor(private readonly opts: SessionOptions) {
    this.cache = new ByteLru(opts.cacheBytes ?? 4 * 1024 * 1024);
  }

  async check(source: string, theoremName: string): Promise<CheckOutcome> {
    const generation = ++this.generation;
    const engine = (this.engine ??= this.opts.createEngine());
    const key = `${engine.identity}\u0000${theoremName}\u0000${source}`;
    const cached = this.cache.get(key);
    if (cached) return { kind: 'result', generation, response: cached };

    const requestId = `r${++this.nextRequest}`;
    try {
      const response = await engine.check({ version: PROTOCOL_VERSION, requestId, source, theoremName });
      this.cache.set(key, response, JSON.stringify(response).length * 2);
      if (generation !== this.generation) return { kind: 'stale', generation };
      return { kind: 'result', generation, response };
    } catch (e) {
      if (e instanceof EngineUnavailableError) this.retire(engine);
      if (generation !== this.generation) return { kind: 'stale', generation };
      return { kind: 'unavailable', generation, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Ask Lean about source that is not the player's proof (a preview of
   * steps they could add). It shares the engine and the cache but is not a
   * submission: it never makes a real check stale, and a failure returns
   * `null` rather than a state the view has to show.
   */
  async probe(source: string): Promise<CheckResponse | null> {
    // A preview is a convenience. If one ever takes the runtime down, stop
    // asking for them rather than restart Lean over and over.
    if (this.probesOff) return null;
    const engine = (this.engine ??= this.opts.createEngine());
    const key = `${engine.identity}\u0000\u0000${source}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    try {
      const response = await engine.check({ version: PROTOCOL_VERSION, requestId: `p${++this.nextRequest}`, source });
      this.cache.set(key, response, JSON.stringify(response).length * 2);
      return response;
    } catch (e) {
      this.probesOff = true;
      if (e instanceof EngineUnavailableError) this.retire(engine);
      return null;
    }
  }

  /** Drop the current engine; the next check starts a new one. */
  retry(): void {
    if (this.engine) this.retire(this.engine);
  }

  dispose(): void {
    this.retry();
  }

  private retire(engine: Engine): void {
    engine.dispose();
    if (this.engine === engine) this.engine = null;
  }
}
