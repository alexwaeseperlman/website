/// <reference lib="webworker" />
/**
 * Runs the Lean bridge compiled to WebAssembly. One worker owns one Lean
 * heap; after any trap the page discards the worker and starts a new one,
 * so a damaged runtime never answers another request.
 */
import { unpackLibrary } from './library-pack';
import type { FromWorker, ToWorker } from './wasm-protocol';

declare const self: DedicatedWorkerGlobalScope;

interface BridgeModule {
  ccall(name: string, ret: 'number', args: string[], values: unknown[]): number;
  UTF8ToString(ptr: number): string;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
}

const SYSROOT = '/lean';
let mod: BridgeModule | null = null;
let crashed = false;

const post = (m: FromWorker) => self.postMessage(m);

function crash(error: unknown): void {
  if (crashed) return;
  crashed = true;
  post({ type: 'crashed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
}

self.addEventListener('error', (e) => crash(e.error ?? e.message));
self.addEventListener('unhandledrejection', (e) => crash(e.reason));

const CACHE = 'leandoku-runtime';

/**
 * Asset URLs carry the runtime version, so a cached copy is never stale.
 * The Cache API keeps these large files more reliably than the HTTP cache.
 * Copies from other versions are deleted once this one is stored.
 */
async function cachedFetch(url: string, stage: 'download-runtime' | 'download-library'): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = undefined; // storage blocked (private mode); just download
  }
  const data = await fetchWithProgress(url, stage);
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

async function fetchWithProgress(url: string, stage: 'download-runtime' | 'download-library'): Promise<Uint8Array> {
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
      post({ type: 'progress', stage, loaded, total });
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

async function start(runtimeUrl: string, libraryUrl: string): Promise<void> {
  post({ type: 'progress', stage: 'download-runtime' });
  const wasmUrl = new URL(runtimeUrl.replace(/\.js$/, '.wasm'), self.location.href).href;
  const [{ default: factory }, wasmBinary] = await Promise.all([
    import(/* @vite-ignore */ new URL(runtimeUrl, self.location.href).href) as Promise<{
      default: (opts: object) => Promise<BridgeModule>;
    }>,
    cachedFetch(wasmUrl, 'download-runtime'),
  ]);
  post({ type: 'progress', stage: 'download-library' });
  const packed = await cachedFetch(libraryUrl, 'download-library');

  post({ type: 'progress', stage: 'load-library' });
  const m = await factory({
    wasmBinary,
    print: () => undefined,
    printErr: (s: string) => console.warn('[lean]', s),
    onAbort: (what: unknown) => crash(`Lean aborted: ${String(what)}`),
  });
  const files = await unpackLibrary(packed);
  for (const f of files) {
    const path = `${SYSROOT}/lib/lean/${f.path}`;
    m.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    m.FS.writeFile(path, f.data);
  }

  post({ type: 'progress', stage: 'start-lean' });
  const started = JSON.parse(callString(m, 'ld_start', SYSROOT)) as { ok?: boolean; error?: string };
  if (!started.ok) throw new Error(`Lean failed to start: ${started.error ?? 'unknown error'}`);
  mod = m;
  post({ type: 'ready', identity: `wasm:${runtimeUrl}` });
}

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (crashed) return;
  try {
    if (msg.type === 'start') {
      start(msg.runtimeUrl, msg.libraryUrl).catch(crash);
    } else if (msg.type === 'check') {
      if (!mod) throw new Error('check before Lean started');
      post({ type: 'result', id: msg.id, response: callString(mod, 'ld_check', msg.request) });
    }
  } catch (err) {
    crash(err);
  }
});
