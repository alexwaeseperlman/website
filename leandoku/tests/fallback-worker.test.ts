import { describe, expect, it } from 'vitest';
import { FallbackWorker, prefersMainThread, type WorkerLike } from '../src/engine/main-thread-host';
import type { FromWorker, ToWorker } from '../src/engine/wasm-protocol';

class Fake implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  private events = new EventTarget();
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  addEventListener(type: string, fn: (e: never) => void) {
    this.events.addEventListener(type, fn as EventListener);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: FromWorker) {
    this.events.dispatchEvent(new MessageEvent('message', { data: m }));
  }
}

const start: ToWorker = { type: 'start', runtimeUrl: 'r.js', libraryUrl: 'l.ldpk' };

describe('FallbackWorker', () => {
  it('moves to the fallback on a stack overflow and replays unanswered work', () => {
    const worker = new Fake();
    const main = new Fake();
    const fw = new FallbackWorker(worker, () => main, 'fp');
    const seen: FromWorker[] = [];
    fw.addEventListener('message', ((e: MessageEvent<FromWorker>) => seen.push(e.data)) as never);
    fw.postMessage(start);
    worker.reply({ type: 'ready', identity: 'x' });
    fw.postMessage({ type: 'check', id: 1, request: 'a' });
    worker.reply({ type: 'result', id: 1, response: 'ra' });
    fw.postMessage({ type: 'check', id: 2, request: 'b' });
    worker.reply({ type: 'crashed', error: 'RangeError: Maximum call stack size exceeded.' });
    expect(worker.terminated).toBe(true);
    expect(main.sent).toEqual([start, { type: 'check', id: 2, request: 'b' }]);
    main.reply({ type: 'result', id: 2, response: 'rb' });
    expect(seen.map((m) => m.type)).toEqual(['ready', 'result', 'result']);
  });

  it('passes other crashes through', () => {
    const worker = new Fake();
    const main = new Fake();
    const fw = new FallbackWorker(worker, () => main, 'fp');
    const seen: FromWorker[] = [];
    fw.addEventListener('message', ((e: MessageEvent<FromWorker>) => seen.push(e.data)) as never);
    fw.postMessage(start);
    worker.reply({ type: 'crashed', error: 'RuntimeError: unreachable' });
    expect(seen).toEqual([{ type: 'crashed', error: 'RuntimeError: unreachable' }]);
    expect(main.sent).toEqual([]);
  });

  it('remembers the main thread only for the same browser and Lean build', () => {
    const store = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    try {
      const worker = new Fake();
      const fw = new FallbackWorker(worker, () => new Fake(), 'build-1|Safari 18');
      fw.postMessage(start);
      worker.reply({ type: 'crashed', error: 'RangeError: Maximum call stack size exceeded.' });
      expect(prefersMainThread('build-1|Safari 18')).toBe(true);
      expect(prefersMainThread('build-2|Safari 18')).toBe(false);
      expect(prefersMainThread('build-1|Safari 19')).toBe(false);
    } finally {
      g.localStorage = saved;
    }
  });
});
