import type { CheckRequest, CheckResponse } from './protocol';

/**
 * Anything that can run the Lean bridge: a native process (development and
 * CI) or a WebAssembly worker (the browser). The rest of the game only sees
 * this interface.
 */
export interface Engine {
  /** Identifies the bridge build, so cached results never cross builds. */
  readonly identity: string;
  check(req: CheckRequest): Promise<CheckResponse>;
  dispose(): void;
}

/** The runtime itself failed (crash, lost connection), as opposed to Lean rejecting a proof. */
export class EngineUnavailableError extends Error {}
