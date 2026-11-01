import type { Engine } from './engine';
import { engineFingerprint, FallbackWorker, MainThreadHost, prefersMainThread } from './main-thread-host';
import { NativeHttpEngine } from './native-client';
import { WasmEngine, type StartupProgress, type WasmAssets } from './wasm-client';
import type { WarmUpCheck } from './wasm-host';

export type EngineChoice =
  | { kind: 'native'; endpoint: string }
  | { kind: 'wasm'; assets: WasmAssets }
  | { kind: 'none' };

/**
 * Which engine the page uses.
 *
 * The published page runs Lean in the browser. The deploy workflow downloads
 * the runtime built by CI into `public/runtime/<version>/` and passes the
 * version as VITE_LEANDOKU_RUNTIME, so each build pins exactly one runtime
 * and caches can never mix two.
 *
 * In development (`npm run dev`) the page uses the native engine through the
 * `/engine` proxy, unless the URL has `?engine=wasm` and a runtime is present.
 */
export function chooseEngine(): EngineChoice {
  const runtime = import.meta.env.VITE_LEANDOKU_RUNTIME as string | undefined;
  const wantWasm = !import.meta.env.DEV || new URLSearchParams(location.search).get('engine') === 'wasm';
  if (wantWasm && runtime) {
    const base = new URL(`runtime/${runtime}/`, document.baseURI);
    return {
      kind: 'wasm',
      assets: {
        version: runtime,
        runtimeUrl: new URL('leandoku-bridge.js', base).href,
        libraryUrl: new URL('library.ldpk', base).href,
      },
    };
  }
  if (import.meta.env.DEV) return { kind: 'native', endpoint: '/engine' };
  return { kind: 'none' };
}

/**
 * `warmUp` is only used when Lean ends up on the page's main thread (iPhone);
 * see HostOptions.warmUp.
 */
export function createEngine(
  choice: EngineChoice,
  onProgress?: (p: StartupProgress | null) => void,
  warmUp: () => WarmUpCheck[] = () => [],
): Engine {
  switch (choice.kind) {
    case 'native':
      return new NativeHttpEngine(`${choice.endpoint}/check`);
    case 'wasm': {
      // Lean runs in a worker wherever the worker's stack is big enough;
      // see FallbackWorker for the iPhone case.
      const fingerprint = engineFingerprint(choice.assets.version);
      return new WasmEngine({
        assets: choice.assets,
        createWorker: () =>
          prefersMainThread(fingerprint)
            ? new MainThreadHost(warmUp())
            : new FallbackWorker(
                new Worker(new URL('./wasm-worker.ts', import.meta.url), { type: 'module' }),
                () => new MainThreadHost(warmUp()),
                fingerprint,
              ),
        onProgress,
      });
    }
    case 'none':
      throw new Error('no engine');
  }
}
