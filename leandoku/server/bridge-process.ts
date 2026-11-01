import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BRIDGE_BINARY = path.resolve(here, '../lean/.lake/build/bin/leandoku-bridge');

/**
 * The bridge needs Lean's install directory to find `Init`. Prefer an
 * explicit LEAN_SYSROOT, then `lean` on PATH, then the toolchain elan
 * installed for `lean/lean-toolchain`.
 */
export function leanSysroot(): string | undefined {
  if (process.env.LEAN_SYSROOT) return process.env.LEAN_SYSROOT;
  const leanBins = ['lean', path.join(os.homedir(), '.elan/bin/lean')];
  for (const bin of leanBins) {
    try {
      return execFileSync(bin, ['--print-prefix'], { cwd: path.resolve(here, '../lean'), encoding: 'utf8' }).trim();
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * One long-lived native bridge process. Requests are answered strictly in
 * order, one JSON line each. If the process dies, every pending request fails
 * and the next call starts a fresh process.
 */
export class BridgeProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sysroot: string | undefined;
  private pending: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];

  constructor(private readonly binary = BRIDGE_BINARY) {}

  private start(): ChildProcessWithoutNullStreams {
    if (!existsSync(this.binary)) throw new Error(`bridge binary missing at ${this.binary}; run npm run bridge:build`);
    this.sysroot ??= leanSysroot();
    const env = this.sysroot ? { ...process.env, LEAN_SYSROOT: this.sysroot } : process.env;
    const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const waiter = this.pending.shift();
      if (!waiter) return;
      try {
        waiter.resolve(JSON.parse(line));
      } catch (e) {
        waiter.reject(new Error(`bridge sent invalid JSON: ${String(e)}`));
      }
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      const err = new Error(`bridge exited (${signal ?? code}): ${stderr.trim()}`);
      for (const w of this.pending.splice(0)) w.reject(err);
    });
    child.on('error', (e) => {
      for (const w of this.pending.splice(0)) w.reject(e);
    });
    return child;
  }

  request(body: unknown): Promise<unknown> {
    this.child ??= this.start();
    const child = this.child;
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      child.stdin.write(JSON.stringify(body) + '\n');
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
  }
}
