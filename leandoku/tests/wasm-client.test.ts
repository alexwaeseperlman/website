import { describe, expect, it } from 'vitest';
import { EngineUnavailableError } from '../src/engine/engine';
import { PROTOCOL_VERSION } from '../src/engine/protocol';
import { WasmEngine, type StartupProgress } from '../src/engine/wasm-client';
import type { FromWorker, ToWorker } from '../src/engine/wasm-protocol';

/** A stand-in worker whose replies the test scripts. */
class FakeWorker extends EventTarget {
  sent: ToWorker[] = [];
  terminated = false;
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: FromWorker) {
    this.dispatchEvent(new MessageEvent('message', { data: m }));
  }
}

const assets = { runtimeUrl: 'r.js', libraryUrl: 'l.ldpk', version: 'v1' };
const req = (id: string) => ({ version: PROTOCOL_VERSION, requestId: id, source: 'x', theoremName: 't' });
const ok = (id: string) => JSON.stringify({ version: PROTOCOL_VERSION, requestId: id, messages: [], tactics: [], completion: { theoremName: 't', exists_: true, axioms: [] } });

function setup(opts: { checkTimeoutMs?: number; startupTimeoutMs?: number } = {}) {
  const worker = new FakeWorker();
  const progress: (StartupProgress | null)[] = [];
  const engine = new WasmEngine({
    assets,
    createWorker: () => worker as unknown as Worker,
    onProgress: (p) => progress.push(p),
    ...opts,
  });
  return { worker, engine, progress };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('WasmEngine', () => {
  it('starts the worker, reports progress, then answers checks', async () => {
    const { worker, engine, progress } = setup();
    expect(worker.sent[0]).toEqual({ type: 'start', runtimeUrl: 'r.js', libraryUrl: 'l.ldpk' });
    const pending = engine.check(req('a'));
    worker.reply({ type: 'progress', stage: 'download-library', loaded: 5, total: 10 });
    worker.reply({ type: 'ready', identity: 'x' });
    await tick();
    const sent = worker.sent[1] as Extract<ToWorker, { type: 'check' }>;
    expect(sent.type).toBe('check');
    worker.reply({ type: 'result', id: sent.id, response: ok('a') });
    expect((await pending).requestId).toBe('a');
    expect(progress).toEqual([{ stage: 'download-library', loaded: 5, total: 10 }, null]);
    expect(engine.identity).toBe('wasm:v1');
  });

  it('rejects everything and kills the worker on a crash', async () => {
    const { worker, engine } = setup();
    worker.reply({ type: 'ready', identity: 'x' });
    const pending = engine.check(req('a'));
    await tick();
    worker.reply({ type: 'crashed', error: 'RuntimeError: unreachable' });
    await expect(pending).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(engine.check(req('b'))).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(worker.terminated).toBe(true);
  });

  it('fails a check that runs too long', async () => {
    const { worker, engine } = setup({ checkTimeoutMs: 20 });
    worker.reply({ type: 'ready', identity: 'x' });
    await expect(engine.check(req('a'))).rejects.toThrow(/too long/);
    expect(worker.terminated).toBe(true);
  });

  it('fails when startup never finishes', async () => {
    const { worker, engine } = setup({ startupTimeoutMs: 20 });
    await expect(engine.check(req('a'))).rejects.toThrow(/too long to start/);
    expect(worker.terminated).toBe(true);
  });

  it('treats a bridge error reply as the runtime failing', async () => {
    const { worker, engine } = setup();
    worker.reply({ type: 'ready', identity: 'x' });
    const pending = engine.check(req('a'));
    await tick();
    const sent = worker.sent[1] as Extract<ToWorker, { type: 'check' }>;
    worker.reply({ type: 'result', id: sent.id, response: '{"error":"bad request"}' });
    await expect(pending).rejects.toBeInstanceOf(EngineUnavailableError);
  });
});
