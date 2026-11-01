/**
 * Runs the Lean bridge compiled to WebAssembly: downloads the runtime and
 * library, starts Lean, and answers checks. It runs inside a Web Worker
 * (wasm-worker.ts) or, where the worker's call stack is too small for Lean,
 * on the page's main thread (main-thread-host.ts). One host owns one Lean
 * heap; after any failure the host is discarded and a new one started.
 */
import { gunzip, unpackLibrary } from './library-pack';
import type { FromWorker, ToWorker } from './wasm-protocol';

type Post = (m: FromWorker) => void;

interface BridgeModule {
  ccall(name: string, ret: 'number', args: string[], values: unknown[]): number;
  UTF8ToString(ptr: number): string;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
}

const SYSROOT = '/lean';

const CACHE = 'leandoku-runtime';

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * Asset URLs carry the runtime version, so a cached copy is never stale.
 * The Cache API keeps these large files more reliably than the HTTP cache.
 * Copies from other versions are deleted once this one is stored.
 */
async function cachedFetch(post: Post, url: string, stage: 'download-runtime' | 'download-library'): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = undefined; // storage blocked (private mode); just download
  }
  const data = await fetchWithProgress(post, url, stage);
  if (cache) {
    try {
      await cache.put(url, new Response(data));
      const file = url.slice(url.lastIndexOf('/'));
      for (const req of await cache.keys()) {
        if (req.url !== url && req.url.endsWith(file)) await cache.delete(req);
      }
    } catch {
      // out of quota: fine, next visit downloads again
    }
  }
  return data;
}

async function fetchWithProgress(post: Post, url: string, stage: 'download-runtime' | 'download-library'): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - lastReport > 512 * 1024) {
      lastReport = loaded;
      post({ type: 'progress', stage, loaded, total: total && loaded <= total ? total : undefined });
    }
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Call a glue function that returns a malloc'd string, and free it. */
function callString(m: BridgeModule, name: string, arg: string): string {
  const ptr = m.ccall(name, 'number', ['string'], [arg]);
  const text = m.UTF8ToString(ptr);
  m.ccall('ld_free', 'number', ['number'], [ptr]);
  return text;
}

export interface Host {
  handle(msg: ToWorker): void;
  crash(error: unknown): void;
}

/** A proof to check, and discard, while warming up. */
export interface WarmUpCheck {
  source: string;
  theoremName: string;
}

export interface HostOptions {
  /**
   * Shallow proofs to check a few times before reporting ready. Safari
   * compiles wasm first with a baseline compiler whose call frames are
   * several times larger than its optimizing compiler's, so deep
   * elaboration on a cold runtime overflows a tight stack (the page's main
   * thread on iPhone) that a warmed-up one fits in comfortably. The proofs
   * should use the course's own definitions: warming up on unrelated Lean
   * leaves the paths the levels take cold.
   */
  warmUp?: WarmUpCheck[];
}

const WARM_UP_ROUNDS = 3;
/** Fresh instances the warm-up may use up before giving up on warming. */
const WARM_UP_REBOOTS = 4;

const STACK_OVERFLOW = /call stack|stack size|too much recursion/i;
/** Fresh instances a check may get after overflowing the stack. */
const OVERFLOW_RETRIES = 3;

interface Runtime {
  factory: (opts: object) => Promise<BridgeModule>;
  module: WebAssembly.Module;
  files: { path: string; data: Uint8Array }[];
}

export function createHost(post: Post, baseHref: string, options: HostOptions = {}): Host {
  let runtime: Runtime | null = null;
  let mod: BridgeModule | null = null;
  let crashed = false;
  // Checks run one at a time, after startup, in the order they arrive.
  let queue: Promise<unknown> = Promise.resolve();

  function crash(error: unknown): void {
    if (crashed) return;
    crashed = true;
    post({ type: 'crashed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }

  /**
   * A fresh Lean heap from the already-compiled module. Reusing the module
   * keeps the engine's optimized code, so a new instance starts warm.
   */
  async function boot(rt: Runtime): Promise<BridgeModule> {
    const m = await rt.factory({
      instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
        WebAssembly.instantiate(rt.module, imports).then((inst) => done(inst, rt.module), crash);
        return {};
      },
      print: () => undefined,
      printErr: (s: string) => console.warn('[lean]', s),
      onAbort: (what: unknown) => crash(`Lean aborted: ${String(what)}`),
    });
    for (const f of rt.files) {
      const path = `${SYSROOT}/lib/lean/${f.path}`;
      m.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      m.FS.writeFile(path, f.data);
    }
    const started = JSON.parse(callString(m, 'ld_start', SYSROOT)) as { ok?: boolean; error?: string };
    if (!started.ok) throw new Error(`Lean failed to start: ${started.error ?? 'unknown error'}`);
    return m;
  }

  /** Run `f` against a live heap, replacing the heap after a stack overflow. */
  async function withRetry<T>(f: (m: BridgeModule) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return f(mod!);
      } catch (err) {
        if (attempt >= OVERFLOW_RETRIES || !STACK_OVERFLOW.test(String(err))) throw err;
        mod = null;
        await new Promise((r) => setTimeout(r, 0)); // let the old heap go
        mod = await boot(runtime!);
      }
    }
  }

  async function start(runtimeUrl: string, libraryUrl: string): Promise<void> {
    post({ type: 'progress', stage: 'download-runtime' });
    // Shipped gzipped: smaller, and under GitHub Pages' per-file size limit.
    const wasmUrl = new URL(runtimeUrl.replace(/\.js$/, '.wasm.gz'), baseHref).href;
    const [{ default: factory }, wasmGz] = await Promise.all([
      import(/* @vite-ignore */ new URL(runtimeUrl, baseHref).href) as Promise<{
        default: (opts: object) => Promise<BridgeModule>;
      }>,
      cachedFetch(post, wasmUrl, 'download-runtime'),
    ]);
    // Some servers mark .gz files as gzip-encoded, and then fetch has already
    // decompressed them; only gunzip what is still gzip.
    const wasmBinary = isGzip(wasmGz) ? await gunzip(wasmGz) : wasmGz;
    post({ type: 'progress', stage: 'download-library' });
    const packed = await cachedFetch(post, libraryUrl, 'download-library');

    post({ type: 'progress', stage: 'load-library' });
    const [module, files] = await Promise.all([WebAssembly.compile(wasmBinary), unpackLibrary(packed)]);
    runtime = { factory, module, files };

    post({ type: 'progress', stage: 'start-lean' });
    mod = await boot(runtime);
    if (options.warmUp?.length) {
      post({ type: 'progress', stage: 'warm-up' });
      let reboots = 0;
      warming: for (let i = 0; i < WARM_UP_ROUNDS; i++) {
        for (const { source, theoremName } of options.warmUp) {
          const request = JSON.stringify({ version: 1, requestId: 'warm-up', source, theoremName });
          try {
            callString(mod, 'ld_check', request);
          } catch (err) {
            // Overflowing here still warmed some code; carry on with a fresh heap.
            if (!STACK_OVERFLOW.test(String(err))) throw err;
            mod = null;
            await new Promise((r) => setTimeout(r, 0));
            mod = await boot(runtime);
            if (++reboots >= WARM_UP_REBOOTS) break warming;
          }
          await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
        }
      }
    }
    post({ type: 'ready', identity: `wasm:${runtimeUrl}` });
  }

  return {
    crash,
    handle(msg) {
      if (crashed) return;
      if (msg.type === 'start') {
        queue = start(msg.runtimeUrl, msg.libraryUrl);
        queue.catch(crash);
      } else if (msg.type === 'check') {
        queue = queue
          .then(async () => {
            if (crashed) return;
            if (!mod) throw new Error('check before Lean started');
            post({ type: 'result', id: msg.id, response: await withRetry((m) => callString(m, 'ld_check', msg.request)) });
          })
          .catch(crash);
      }
    },
  };
}
