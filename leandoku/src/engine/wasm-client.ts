import { EngineUnavailableError, type Engine } from './engine';
import { parseCheckResponse, type CheckRequest, type CheckResponse } from './protocol';
import type { FromWorker, StartupStage, ToWorker } from './wasm-protocol';

export interface WasmAssets {
  /** The emscripten ES module (`leandoku-bridge.js`); its `.wasm` sits beside it. */
  runtimeUrl: string;
  /** The packed Lean library (`library.ldpk`, a gzipped pack; see library-pack.ts). */
  libraryUrl: string;
  /** Names this build, e.g. the asset version, so cached results never cross builds. */
  version: string;
}

export interface StartupProgress {
  stage: StartupStage;
  loaded?: number;
  total?: number;
}

export interface WasmEngineOptions {
  assets: WasmAssets;
  createWorker: () => Worker;
  onProgress?: (p: StartupProgress | null) => void;
  /** Download plus first import. Generous: phones on slow networks. */
  startupTimeoutMs?: number;
  /** One check, once Lean is running. */
  checkTimeoutMs?: number;
}

interface Pending {
  resolve: (r: CheckResponse) => void;
  reject: (e: Error) => void;
  req: CheckRequest;
}

/**
 * Runs the bridge in a Web Worker. Startup is staged (runtime, library,
 * Lean) and reported through `onProgress`. Any failure, whether a trap,
 * a missing asset or a timeout, kills the worker and rejects every pending
 * check with EngineUnavailableError; the session then drops this engine
 * and the next check starts a fresh one.
 */
export class WasmEngine implements Engine {
  readonly identity: string;
  private worker: Worker | null;
  private ready: Promise<void>;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private dead: Error | null = null;
  private readonly checkTimeoutMs: number;

  constructor(private readonly opts: WasmEngineOptions) {
    this.identity = `wasm:${opts.assets.version}`;
    this.checkTimeoutMs = opts.checkTimeoutMs ?? 60_000;
    const worker = opts.createWorker();
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new EngineUnavailableError('Lean took too long to start')),
        opts.startupTimeoutMs ?? 300_000,
      );
      worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            opts.onProgress?.({ stage: msg.stage, loaded: msg.loaded, total: msg.total });
            break;
          case 'ready':
            clearTimeout(timer);
            opts.onProgress?.(null);
            resolve();
            break;
          case 'result':
            this.settle(msg.id, msg.response);
            break;
          case 'crashed':
            clearTimeout(timer);
            this.fail(new EngineUnavailableError(`Lean stopped: ${msg.error}`));
            break;
        }
      });
      worker.addEventListener('error', (e) => {
        clearTimeout(timer);
        this.fail(new EngineUnavailableError(`Lean worker failed: ${e.message || 'could not load'}`));
      });
      this.onDead = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
    // Unobserved until the first check; avoid an unhandled-rejection report.
    this.ready.catch(() => undefined);
    this.post({ type: 'start', runtimeUrl: opts.assets.runtimeUrl, libraryUrl: opts.assets.libraryUrl });
  }

  private onDead: (err: Error) => void = () => undefined;

  async check(req: CheckRequest): Promise<CheckResponse> {
    if (this.dead) throw this.dead;
    await this.ready;
    if (this.dead) throw this.dead;
    const id = ++this.nextId;
    return new Promise<CheckResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new EngineUnavailableError('Lean took too long on this step')),
        this.checkTimeoutMs,
      );
      this.pending.set(id, {
        req,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.post({ type: 'check', id, request: JSON.stringify(req) });
    });
  }

  dispose(): void {
    this.fail(new EngineUnavailableError('engine disposed'));
  }

  private post(msg: ToWorker): void {
    this.worker?.postMessage(msg);
  }

  private settle(id: number, response: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    try {
      const raw = JSON.parse(response) as unknown;
      if (raw && typeof raw === 'object' && 'error' in raw && !('messages' in raw)) {
        p.reject(new EngineUnavailableError(`Lean bridge: ${String((raw as { error: unknown }).error)}`));
      } else {
        p.resolve(parseCheckResponse(raw, p.req));
      }
    } catch (e) {
      p.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private fail(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    this.worker?.terminate();
    this.worker = null;
    this.opts.onProgress?.(null);
    this.onDead(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
