import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineUnavailableError, type Engine } from '../src/engine/engine';
import { unpackLibrary } from '../src/engine/library-pack';
import { parseCheckResponse, type CheckRequest, type CheckResponse } from '../src/engine/protocol';

interface BridgeModule {
  ccall(name: string, ret: 'number', args: string[], values: unknown[]): number;
  UTF8ToString(ptr: number): string;
  FS: { mkdirTree(p: string): void; writeFile(p: string, data: Uint8Array): void };
}

/**
 * The browser runtime (`wasm/build-runtime.sh` output) loaded in Node, so the
 * Lean tests can run against exactly what the page runs:
 * LEANDOKU_WASM_RUNTIME=<dir> npm run test:lean
 */
export class WasmNodeEngine implements Engine {
  readonly identity: string;
  private mod: Promise<BridgeModule>;

  constructor(private readonly dir: string) {
    this.identity = `wasm-node:${dir}`;
    this.mod = this.start();
    this.mod.catch(() => undefined);
  }

  private async start(): Promise<BridgeModule> {
    const { default: factory } = (await import(pathToFileURL(path.join(this.dir, 'leandoku-bridge.js')).href)) as {
      default: (o: object) => Promise<BridgeModule>;
    };
    const m = await factory({ wasmBinary: gunzipSync(readFileSync(path.join(this.dir, 'leandoku-bridge.wasm.gz'))), print: () => {} });
    for (const f of await unpackLibrary(new Uint8Array(readFileSync(path.join(this.dir, 'library.ldpk'))))) {
      const p = `/lean/lib/lean/${f.path}`;
      m.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
      m.FS.writeFile(p, f.data);
    }
    const started = JSON.parse(this.call(m, 'ld_start', '/lean')) as { ok?: boolean; error?: string };
    if (!started.ok) throw new EngineUnavailableError(`Lean failed to start: ${started.error}`);
    return m;
  }

  private call(m: BridgeModule, name: string, arg: string): string {
    const ptr = m.ccall(name, 'number', ['string'], [arg]);
    const s = m.UTF8ToString(ptr);
    m.ccall('ld_free', 'number', ['number'], [ptr]);
    return s;
  }

  async check(req: CheckRequest): Promise<CheckResponse> {
    const m = await this.mod;
    const raw = JSON.parse(this.call(m, 'ld_check', JSON.stringify(req))) as unknown;
    if (raw && typeof raw === 'object' && 'error' in raw) throw new EngineUnavailableError(String((raw as { error: unknown }).error));
    return parseCheckResponse(raw, req);
  }

  dispose(): void {}
}
