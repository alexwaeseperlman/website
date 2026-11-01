/**
 * Load the built runtime in Node, the way the worker does, and prove two
 * small theorems: one that should succeed and one that should fail.
 *
 *   node --experimental-strip-types wasm/smoke-test.ts <runtime dir>
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unpackLibrary } from '../src/engine/library-pack.ts';

const dir = path.resolve(process.argv[2] ?? 'dist-runtime');
const { default: factory } = await import(pathToFileURL(path.join(dir, 'leandoku-bridge.js')).href);
const m = await factory({ wasmBinary: readFileSync(path.join(dir, 'leandoku-bridge.wasm')) });

const call = (name: string, arg: string): string => {
  const ptr = m.ccall(name, 'number', ['string'], [arg]);
  const s = m.UTF8ToString(ptr);
  m.ccall('ld_free', 'number', ['number'], [ptr]);
  return s;
};

let t = performance.now();
for (const f of await unpackLibrary(new Uint8Array(readFileSync(path.join(dir, 'library.ldpk'))))) {
  const p = `/lean/lib/lean/${f.path}`;
  m.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
  m.FS.writeFile(p, f.data);
}
console.log(`library unpacked in ${Math.round(performance.now() - t)} ms`);
t = performance.now();
const started = JSON.parse(call('ld_start', '/lean'));
if (!started.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
console.log(`Lean started in ${Math.round(performance.now() - t)} ms`);

const source = (proof: string) => `set_option autoImplicit false
inductive N where
  | zero : N
  | succ : N → N
def N.add : N → N → N
  | n, .zero => n
  | n, .succ m => .succ (N.add n m)
instance : Add N := ⟨N.add⟩
theorem add_succ (n m : N) : n + .succ m = .succ (n + m) := rfl
theorem zero_add (n : N) : .zero + n = n := by
${proof}
`;
const check = (proof: string) => {
  const t0 = performance.now();
  const res = JSON.parse(call('ld_check', JSON.stringify({ version: 1, requestId: 's', source: source(proof), theoremName: 'zero_add' })));
  console.log(`checked in ${Math.round(performance.now() - t0)} ms`);
  return res;
};

const good = check('  induction n with\n  | zero => rfl\n  | succ n ih => rw [add_succ, ih]');
const errors = (r: { messages?: { severity: string; text: string }[] }) => (r.messages ?? []).filter((x) => x.severity === 'error');
if (errors(good).length || !good.completion?.exists_ || good.completion.axioms.length || !good.tactics?.length) {
  throw new Error(`expected a complete proof, got ${JSON.stringify(good).slice(0, 2000)}`);
}
const bad = check('  rfl');
if (!errors(bad).length) throw new Error(`expected an error, got ${JSON.stringify(bad).slice(0, 2000)}`);
console.log('smoke test passed');
