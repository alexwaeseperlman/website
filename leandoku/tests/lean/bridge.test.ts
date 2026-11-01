/**
 * End-to-end checks through the real Lean bridge. Run `npm run bridge:build`
 * first; set LEANDOKU_LEAN_TESTS=1 to fail (rather than skip) when the bridge
 * binary is missing, as CI does.
 */
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { naturalCourse } from '../../content/natural/course';
import { defaultCatalog } from '../../src/core/catalog/registry';
import { levelSource } from '../../src/core/course/environment';
import type { ScriptStep } from '../../src/core/course/types';
import { emptyDocument, insertStep, locateStep, makeStep, setBranches, ROOT_BRANCH } from '../../src/core/document/edit';
import type { ProofDocument } from '../../src/core/document/types';
import { evaluate, type Evaluation } from '../../src/core/evaluate/evaluate';
import { checkPolicy } from '../../src/core/policy/policy';
import { serialize, type LevelSource } from '../../src/core/serializer/serialize';
import { PROTOCOL_VERSION } from '../../src/engine/protocol';
import { BRIDGE_BINARY } from '../../server/bridge-process';
import { BridgeEngine } from '../../server/bridge-engine';
import { counterIds } from '../helpers';

const required = process.env.LEANDOKU_LEAN_TESTS === '1';
const available = existsSync(BRIDGE_BINARY);
if (required && !available) throw new Error(`bridge binary missing at ${BRIDGE_BINARY}; run npm run bridge:build`);

const catalog = defaultCatalog();
const engine = available ? new BridgeEngine() : null;
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

/**
 * Play a script the way a player would: commit one action, ask Lean, and
 * open branches only from the goals Lean reports.
 */
async function replay(script: readonly ScriptStep[], level: LevelSource): Promise<{ doc: ProofDocument; ev: Evaluation; source: string }> {
  const ids = counterIds();
  let doc = emptyDocument();
  let last!: { ev: Evaluation; source: string };
  const play = async (branch: string, steps: readonly ScriptStep[]): Promise<void> => {
    for (const [i, s] of steps.entries()) {
      const step = makeStep(s.tactic, s.args ?? {}, ids);
      doc = insertStep(doc, { branch, index: i }, step);
      last = await check(doc, level);
      const r = last.ev.steps.get(step.id)!;
      expect(r.status, `${s.tactic} in\n${last.source}\n${JSON.stringify(r.errors)}`).toBe('ok');
      if (!s.branches) continue;
      const goals = r.goalsAfter!;
      expect(goals.length).toBe(s.branches.length);
      doc = setBranches(doc, step.id, goals.map((g) => ({ tag: g.tag, names: s.cases?.[g.tag] ?? [] })), ids);
      last = await check(doc, level);
      const created = locateStep(doc, step.id)!.step.branches!;
      created.forEach((b, j) => expect(last.ev.branches.get(b.id)?.goal?.tag).toBe(goals[j]!.tag));
      for (const [j, b] of created.entries()) await play(b.id, s.branches[j]!);
    }
  };
  await play(ROOT_BRANCH, script);
  return { doc, ...last };
}

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

  it('shows the real goals at every checkpoint, with case names from the player', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const { doc, ev } = await replay(zeroAdd.solution, src);
    const ind = doc.root.steps[0]!;
    const before = ev.steps.get(ind.id)!.goalsBefore;
    expect(before).toHaveLength(1);
    expect(before[0]!.target).toBe('zero + n = n');
    const succ = ind.branches![1]!;
    const goal = ev.branches.get(succ.id)!.goal!;
    expect(goal.hyps.map((h) => `${h.name} : ${h.type}`)).toEqual(['n : Natural', 'ih : zero + n = n']);
    expect(goal.target).toBe('zero + succ n = succ n');
  });

  it('marks the failing step and leaves the valid prefix intact', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const bad = makeStep('rfl', {}, ids);
    const doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, bad);
    const { ev } = await check(doc, src);
    expect(ev.status).toBe('rejected');
    const r = ev.steps.get(bad.id)!;
    expect(r.status).toBe('error');
    expect(r.goalsBefore[0]!.target).toBe('zero + n = n');
    expect(r.errors[0]!.text.length).toBeGreaterThan(0);
  });

  it('keeps checking a sibling branch when one branch fails', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const ind = makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, ind);
    doc = setBranches(doc, ind.id, [{ tag: 'zero' }, { tag: 'succ', names: ['m', 'ih'] }], ids);
    const [zero, succ] = locateStep(doc, ind.id)!.step.branches!;
    const wrong = makeStep('rw', { rules: { kind: 'rules', rules: [{ term: 'ih', reverse: false }] } }, ids);
    const right = makeStep('rw', { rules: { kind: 'rules', rules: [{ term: 'add_succ', reverse: false }, { term: 'ih', reverse: false }] } }, ids);
    doc = insertStep(doc, { branch: zero!.id, index: 0 }, wrong);
    doc = insertStep(doc, { branch: succ!.id, index: 0 }, right);
    const { ev } = await check(doc, src);
    expect(ev.steps.get(wrong.id)!.status).toBe('error');
    expect(ev.steps.get(right.id)!.status).toBe('ok');
    expect(ev.steps.get(right.id)!.goalsAfter).toEqual([]);
  });

  it('does not count an unfinished proof as complete', async () => {
    const src = levelSource(naturalCourse, zeroAdd, catalog);
    const ids = counterIds();
    const ind = makeStep('induction', { target: { kind: 'local', name: 'n' } }, ids);
    let doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, ind);
    doc = setBranches(doc, ind.id, [{ tag: 'zero' }, { tag: 'succ', names: ['m', 'ih'] }], ids);
    const { ev, source } = await check(doc, src);
    expect(source).toContain('| succ m ih =>');
    expect(ev.status).toBe('incomplete');
    expect(ev.steps.get(ind.id)!.status).toBe('ok');
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
    const doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, makeStep('raw', { text: { kind: 'raw', text: 'sorry' } }, ids));
    const { ev } = await check(doc, level);
    expect(ev.status).not.toBe('complete');
  });

  it('runs a tactic outside the built-in entries through the raw slot', async () => {
    const level = { prelude: '', theoremName: 'arith', header: 'theorem arith (a b : Nat) : a + b = b + a := by' };
    const ids = counterIds();
    const doc = insertStep(emptyDocument(), { branch: ROOT_BRANCH, index: 0 }, makeStep('raw', { text: { kind: 'raw', text: 'omega' } }, ids));
    const { ev } = await check(doc, level);
    expect(ev.status).toBe('complete');
  });
});
