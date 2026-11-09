/**
 * End-to-end checks through the real Lean bridge. Run `npm run bridge:build`
 * first; set LEANDOKU_LEAN_TESTS=1 to fail (rather than skip) when the bridge
 * binary is missing, as CI does.
 */
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { course as naturalCourse } from '../../content/course';
import { defaultCatalog } from '../../src/core/catalog/registry';
import { levelSource } from '../../src/core/course/environment';
import type { ScriptStep } from '../../src/core/course/types';
import { emptyDocument, insertStep, makeStep } from '../../src/core/document/edit';
import type { ProofDocument } from '../../src/core/document/types';
import { evaluate, type Evaluation } from '../../src/core/evaluate/evaluate';
import { probeSource, readProbe } from '../../src/core/play/probe';
import { checkPolicy } from '../../src/core/policy/policy';
import { serialize, type LevelSource } from '../../src/core/serializer/serialize';
import { PROTOCOL_VERSION } from '../../src/engine/protocol';
import { BRIDGE_BINARY } from '../../server/bridge-process';
import { BridgeEngine } from '../../server/bridge-engine';
import { WasmNodeEngine } from '../../server/wasm-node-engine';
import { counterIds } from '../helpers';

// LEANDOKU_WASM_RUNTIME=<dir> runs these against the browser runtime instead.
const wasmDir = process.env.LEANDOKU_WASM_RUNTIME;
const required = process.env.LEANDOKU_LEAN_TESTS === '1';
const available = wasmDir ? existsSync(wasmDir) : existsSync(BRIDGE_BINARY);
if (required && !available) throw new Error(`bridge binary missing at ${BRIDGE_BINARY}; run npm run bridge:build`);

const catalog = defaultCatalog();
const engine = !available ? null : wasmDir ? new WasmNodeEngine(wasmDir) : new BridgeEngine();
afterAll(() => engine?.dispose());

let req = 0;
async function check(doc: ProofDocument, level: LevelSource): Promise<{ ev: Evaluation; source: string }> {
  const ser = serialize(doc, catalog, level);
  const res = await engine!.check({
    version: PROTOCOL_VERSION,
    requestId: `t${++req}`,
    source: ser.source,
    theoremName: level.theoremName,
  });
  return { ev: evaluate(ser, res), source: ser.source };
}

/** Play a script the way a player would: add one step, ask Lean, and expect it to work. */
async function replay(script: readonly ScriptStep[], level: LevelSource): Promise<{ doc: ProofDocument; ev: Evaluation; source: string }> {
  const ids = counterIds();
  let doc = emptyDocument();
  let last!: { ev: Evaluation; source: string };
  for (const [i, s] of script.entries()) {
    const step = makeStep(s.tactic, s.args ?? {}, ids);
    doc = insertStep(doc, i, step);
    last = await check(doc, level);
    const r = last.ev.steps.get(step.id)!;
    expect(r.status, `${s.tactic} in\n${last.source}\n${JSON.stringify(r.errors)}`).toBe('ok');
  }
  return { doc, ...last };
}

const step = (tactic: string, args: Record<string, unknown> = {}): ScriptStep => ({ tactic, args } as ScriptStep);
const local = (name: string) => ({ kind: 'local', name });
const names = (...ns: string[]) => ({ kind: 'names', names: ns });

describe.skipIf(!available)('Lean bridge', () => {
  for (const level of naturalCourse.levels) {
    it(`replays the reference solution of ${level.id} through the builder`, async () => {
      const src = levelSource(naturalCourse, level, catalog);
      const { doc, ev, source } = await replay(level.solution, src);
      expect(ev.status, source).toBe('complete');
      expect(checkPolicy(doc, level.policy)).toEqual([]);
    });
  }

  const zeroAdd = naturalCourse.levels.find((l) => l.id === 'natural.zero_add')!;

  it('shows the goals Lean reports after induction, with its case tags, and names from rename_i', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const { doc, ev, source } = await replay(zeroAdd.solution, src);
    expect(source).toContain('  induction n\n  rfl\n  rename_i n ih\n');
    const [ind, rfl, rename] = doc.steps;
    const before = ev.steps.get(ind!.id)!.goalsBefore;
    expect(before).toHaveLength(1);
    expect(before[0]!.target).toBe('zero + n = n');
    // induction just leaves Lean's goals, tagged by Lean.
    const after = ev.steps.get(ind!.id)!.goalsAfter!;
    expect(after.map((g) => g.tag)).toEqual(['zero', 'succ']);
    // rfl closes the first; the succ goal is next, its new names hidden…
    const succ = ev.steps.get(rfl!.id)!.goalsAfter!;
    expect(succ.map((g) => g.tag)).toEqual(['succ']);
    expect(succ[0]!.hyps.every((h) => h.inaccessible)).toBe(true);
    // …until rename_i names them.
    const named = ev.steps.get(rename!.id)!.goalsAfter![0]!;
    expect(named.hyps.map((h) => `${h.name} : ${h.type}`)).toEqual(['n : Natural', 'ih : zero + n = n']);
    expect(named.target).toBe('zero + succ n = succ n');
  });

  it('previews candidate steps: the goal each would leave, or why Lean rejects it', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const { doc } = await replay(zeroAdd.solution.slice(0, 3), src);
    const rule = (term: string, reverse = false) => ({ tactic: 'rw', args: { rules: { kind: 'rules' as const, rules: [{ term, reverse }] } } });
    const probe = probeSource(doc, 3, [rule('add_succ'), rule('add_zero'), rule('ih'), rule('ih', true), { tactic: 'rfl', args: {} }], catalog, src);
    const res = await engine!.check({ version: PROTOCOL_VERSION, requestId: `t${++req}`, source: probe.source });
    const [addSucc, addZero, ih, ihBack, byRfl] = readProbe(probe, res);
    expect(addSucc).toMatchObject({ kind: 'ok', goals: [{ target: 'succ (zero + n) = succ n' }] });
    expect(addZero!.kind).toBe('error');
    expect(ih!.kind).toBe('error');
    expect(ihBack!.kind).toBe('ok');
    expect(byRfl!.kind).toBe('error');
    // A candidate that closes the goal leaves one goal fewer.
    const early = probeSource(doc, 1, [{ tactic: 'rfl', args: {} }], catalog, src);
    const closed = readProbe(early, await engine!.check({ version: PROTOCOL_VERSION, requestId: `t${++req}`, source: early.source }));
    expect(closed[0]).toMatchObject({ kind: 'ok', goals: [{ tag: 'succ' }] });
  });

  it('a level that allows no facts cannot cite an earlier theorem, even typed by hand', async () => {
    const level = naturalCourse.levels.find((l) => l.id === 'logic.imp_trans')!;
    expect(level.policy.facts).toEqual([]);
    const src = levelSource(naturalCourse, level, catalog);
    const cite = makeStep('exact', { term: { kind: 'term', text: 'and_swap' } }, counterIds());
    const { ev } = await check(insertStep(emptyDocument(), 0, cite), src);
    expect(ev.steps.get(cite.id)!.errors[0]!.text).toMatch(/[Uu]nknown identifier/);
  });

  it('pulls apart nested ands with cases and rename_i', async () => {
    const src: LevelSource = {
      prelude: 'set_option autoImplicit false',
      theoremName: 'regroup',
      header: 'theorem regroup (P Q R : Prop) (h : (P ∧ Q) ∧ R) : P ∧ Q := by',
    };
    const script = [
      step('cases', { target: local('h') }),
      step('rename_i', { names: names('hpq', 'hr') }),
      step('cases', { target: local('hpq') }),
      step('rename_i', { names: names('hp', 'hq') }),
      step('constructor'),
      step('assumption'),
      step('assumption'),
    ];
    const { ev, source } = await replay(script, src);
    expect(ev.status, source).toBe('complete');
  });

  it('marks the failing step and leaves the valid prefix intact', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const bad = makeStep('rfl', {}, ids);
    const doc = insertStep(emptyDocument(), 0, bad);
    const { ev } = await check(doc, src);
    expect(ev.status).toBe('rejected');
    const r = ev.steps.get(bad.id)!;
    expect(r.status).toBe('error');
    expect(r.goalsBefore[0]!.target).toBe('zero + n = n');
    expect(r.errors[0]!.text.length).toBeGreaterThan(0);
  });

  it('stops at the first failing step, as Lean does', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const ind = makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids);
    const wrong = makeStep('rw', { rules: { kind: 'rules', rules: [{ term: 'ih', reverse: false }] } }, ids);
    const later = makeStep('rfl', {}, ids);
    let doc = insertStep(emptyDocument(), 0, ind);
    doc = insertStep(doc, 1, wrong);
    doc = insertStep(doc, 2, later);
    const { ev } = await check(doc, src);
    expect(ev.steps.get(ind.id)!.status).toBe('ok');
    expect(ev.steps.get(wrong.id)!.status).toBe('error');
    expect(ev.steps.get(wrong.id)!.goalsBefore.map((g) => g.tag)).toEqual(['zero', 'succ']);
    expect(ev.steps.get(later.id)!.status).toBe('blocked');
  });

  it('does not count an unfinished proof as complete', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const ind = makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids);
    const doc = insertStep(emptyDocument(), 0, ind);
    const { ev, source } = await check(doc, src);
    expect(source).toMatch(/  induction n\n$/);
    expect(ev.status).toBe('incomplete');
    expect(ev.steps.get(ind.id)!.status).toBe('ok');
    expect(ev.steps.get(ind.id)!.goalsAfter!.map((g) => g.tag)).toEqual(['zero', 'succ']);
  });

  it('shows the starting goal of an empty proof', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const { ev } = await check(emptyDocument(), src);
    expect(ev.placeholderGoals?.map((g) => g.target)).toEqual(['zero + n = n']);
  });

  it('reports a broken statement as a header error, not a tactic error', async () => {
    const level = { prelude: 'set_option autoImplicit false', theoremName: 'broken', header: 'theorem broken (n : Natral) : n = n := by' };
    const { ev } = await check(emptyDocument(), level);
    expect(ev.status).toBe('rejected');
    expect(ev.headerErrors.length).toBeGreaterThan(0);
  });

  it('rejects a proof that leans on sorry even if Lean accepts the file', async () => {
    const level = { prelude: '', theoremName: 'cheat', header: 'theorem cheat : 1 = 2 := by' };
    const ids = counterIds();
    const doc = insertStep(emptyDocument(), 0, makeStep('raw', { text: { kind: 'raw', text: 'sorry' } }, ids));
    const { ev } = await check(doc, level);
    expect(ev.status).not.toBe('complete');
  });

  it('runs a tactic outside the built-in entries through the raw slot', async () => {
    const level = { prelude: '', theoremName: 'arith', header: 'theorem arith (a b : Nat) : a + b = b + a := by' };
    const ids = counterIds();
    const doc = insertStep(emptyDocument(), 0, makeStep('raw', { text: { kind: 'raw', text: 'omega' } }, ids));
    const { ev } = await check(doc, level);
    expect(ev.status).toBe('complete');
  });
});
