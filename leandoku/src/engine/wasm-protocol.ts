/** Messages between the page and the Lean worker (`wasm-worker.ts`). */

export type StartupStage = 'download-runtime' | 'download-library' | 'load-library' | 'start-lean';

export type ToWorker =
  | { type: 'start'; runtimeUrl: string; libraryUrl: string }
  | { type: 'check'; id: number; request: string };

export type FromWorker =
  | { type: 'progress'; stage: StartupStage; loaded?: number; total?: number }
  | { type: 'ready'; identity: string }
  | { type: 'result'; id: number; response: string }
  /** The runtime itself failed (trap, out of memory, missing asset). The worker must be discarded. */
  | { type: 'crashed'; error: string };
