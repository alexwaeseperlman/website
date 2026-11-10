import { describe, expect, it } from 'vitest';
import { EngineUnavailableError, type Engine } from '../src/engine/engine';
import { ProtocolError, parseCheckResponse, type CheckRequest, type CheckResponse } from '../src/engine/protocol';
import { ByteLru } from '../src/session/lru';
import { Session } from '../src/session/session';

function fakeEngine(behaviour: (req: CheckRequest) => Promise<CheckResponse>, log: string[] = []): Engine {
  return { identity: 'fake', check: behaviour, dispose: () => log.push('disposed') };
}
const empty = (req: CheckRequest): CheckResponse => ({ version: 1, requestId: req.requestId, messages: [], tactics: [] });

describe('session', () => {
  it('never delivers a result older than the latest submission', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const session = new Session({
      createEngine: () =>
        fakeEngine(async (req) => {
          if (++calls === 1) await gate;
          return empty(req);
        }),
    });
    const slow = session.check('a', 't');
    const fast = await session.check('b', 't');
    release();
    expect(fast.kind).toBe('result');
    expect((await slow).kind).toBe('stale');
  });

  it('retires a crashed engine and starts a fresh one', async () => {
    const log: string[] = [];
    let made = 0;
    const session = new Session({
      createEngine: () => {
        const n = ++made;
        return fakeEngine(async (req) => {
          if (n === 1) throw new EngineUnavailableError('trap');
          return empty(req);
        }, log);
      },
    });
    expect((await session.check('a', 't')).kind).toBe('unavailable');
    expect(log).toEqual(['disposed']);
    expect((await session.check('a', 't')).kind).toBe('result');
    expect(made).toBe(2);
  });

  it('previews never make a real check stale', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const session = new Session({
      createEngine: () =>
        fakeEngine(async (req) => {
          if (req.source === 'proof') await gate;
          return empty(req);
        }),
    });
    const real = session.check('proof', 't');
    expect(await session.probe('preview')).not.toBeNull();
    release();
    expect((await real).kind).toBe('result');
  });

  it('stops asking for previews once one has taken the runtime down', async () => {
    let calls = 0;
    const session = new Session({
      createEngine: () =>
        fakeEngine(async (req) => {
          calls++;
          if (req.source === 'preview') throw new EngineUnavailableError('trap');
          return empty(req);
        }),
    });
    expect(await session.probe('preview')).toBeNull();
    expect(await session.probe('preview')).toBeNull();
    expect(calls).toBe(1);
    expect((await session.check('proof', 't')).kind).toBe('result');
  });

  it('bounds its cache by bytes', () => {
    const lru = new ByteLru<string>(10);
    lru.set('a', 'x', 4);
    lru.set('b', 'x', 4);
    lru.get('a');
    lru.set('c', 'x', 4);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe('x');
    expect(lru.bytes).toBeLessThanOrEqual(10);
  });
});

describe('protocol validation', () => {
  const req: CheckRequest = { version: 1, requestId: 'r1', source: '', theoremName: 't' };
  it('rejects responses for another request or missing fields', () => {
    expect(() => parseCheckResponse({ version: 1, requestId: 'r2', messages: [], tactics: [] }, req)).toThrow(ProtocolError);
    expect(() => parseCheckResponse({ version: 1, requestId: 'r1', messages: [], tactics: [] }, req)).toThrow(/completion/);
    expect(() =>
      parseCheckResponse({ version: 1, requestId: 'r1', messages: [], tactics: [{ range: {}, kind: 'x' }] }, { ...req, theoremName: undefined }),
    ).toThrow(ProtocolError);
  });
});
