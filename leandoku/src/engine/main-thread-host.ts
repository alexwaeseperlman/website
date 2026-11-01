import { createHost, type Host } from './wasm-host';
import type { FromWorker, ToWorker } from './wasm-protocol';

/** The part of `Worker` that WasmEngine uses. */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<FromWorker>) => void): void;
  addEventListener(type: 'error', fn: (e: ErrorEvent) => void): void;
  terminate(): void;
}

/**
 * Runs the Lean host on the page's own thread, behind the same messages a
 * worker uses. Safari gives workers a small call stack (about 512 KB on
 * iPhone) that Lean's elaborator outgrows, while its main thread has several
 * megabytes. The page freezes while Lean works, so each call waits for the
 * next frame to let the "checking" state paint first.
 */
export class MainThreadHost implements WorkerLike {
  private host: Host | null;
  private readonly events = new EventTarget();

  constructor() {
    this.host = createHost((m) => {
      queueMicrotask(() => this.host && this.events.dispatchEvent(new MessageEvent('message', { data: m })));
    }, document.baseURI);
  }

  postMessage(msg: ToWorker): void {
    requestAnimationFrame(() => setTimeout(() => this.host?.handle(msg), 0));
  }

  addEventListener(type: string, fn: (e: never) => void): void {
    this.events.addEventListener(type, fn as EventListener);
  }

  terminate(): void {
    this.host = null; // the heap is released once nothing refers to it
  }
}

const STACK_OVERFLOW = /call stack|stack size|too much recursion/i;
const PREFER_MAIN = 'leandoku.engine.mainThread';

export function prefersMainThread(): boolean {
  try {
    return localStorage.getItem(PREFER_MAIN) === '1';
  } catch {
    return false;
  }
}

/**
 * A worker that moves to the main thread if Lean overflows the worker's call
 * stack: it replays the start message and any unanswered checks into a
 * MainThreadHost, so WasmEngine sees a slow answer instead of a crash. The
 * choice is remembered so later visits start on the main thread directly.
 */
export class FallbackWorker implements WorkerLike {
  private readonly events = new EventTarget();
  private current: WorkerLike;
  private moved = false;
  private start: ToWorker | null = null;
  private pending = new Map<number, ToWorker>();

  constructor(worker: WorkerLike, private readonly fallback: () => WorkerLike) {
    this.current = worker;
    this.attach(worker);
  }

  private attach(w: WorkerLike): void {
    w.addEventListener('message', (e: MessageEvent<FromWorker>) => {
      if (w !== this.current) return;
      const m = e.data;
      if (m.type === 'crashed' && !this.moved && STACK_OVERFLOW.test(m.error)) {
        this.moveToMainThread();
        return;
      }
      if (m.type === 'result') this.pending.delete(m.id);
      this.events.dispatchEvent(new MessageEvent('message', { data: m }));
    });
    w.addEventListener('error', (e: ErrorEvent) => {
      if (w === this.current) this.events.dispatchEvent(new ErrorEvent('error', { message: e.message, error: e.error }));
    });
  }

  private moveToMainThread(): void {
    this.moved = true;
    try {
      localStorage.setItem(PREFER_MAIN, '1');
    } catch {
      // storage blocked: we just fall back again next visit
    }
    this.current.terminate();
    this.current = this.fallback();
    this.attach(this.current);
    if (this.start) this.current.postMessage(this.start);
    for (const m of this.pending.values()) this.current.postMessage(m);
  }

  postMessage(msg: ToWorker): void {
    if (msg.type === 'start') this.start = msg;
    else this.pending.set(msg.id, msg);
    this.current.postMessage(msg);
  }

  addEventListener(type: string, fn: (e: never) => void): void {
    this.events.addEventListener(type, fn as EventListener);
  }

  terminate(): void {
    this.current.terminate();
  }
}
