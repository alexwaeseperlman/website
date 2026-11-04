#!/usr/bin/env node
/*
  Turn calls in tail position into WebAssembly tail calls.

    node wasm/tail-calls.mjs <in.wasm> <out.wasm>

  Lean code is deeply recursive, and Safari gives WebAssembly a small stack,
  so every frame we can drop matters. clang only emits `return_call` when the
  call is directly followed by `ret` in the same basic block. Most Lean
  functions have several `return`s, which clang merges into one return
  block, so their calls in tail position stay ordinary calls (`call f` then
  `return`) and keep their frame alive.

  This pass rewrites, in place, a `call` or `call_indirect` that is followed
  by `return`, or that is the last instruction of the function body, into
  `return_call` or `return_call_indirect` (same immediates, same size). It
  skips:
  - calls inside a `try` or `catch` (a tail call would leave the handler);
  - calls to imported (JavaScript) functions;
  - calls whose result types differ from the caller's (invalid as a tail
    call).
  A call directly followed by `return` has nothing left to do in its
  caller, including restoring the C stack pointer, so dropping the frame
  does not change behaviour.
*/
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: tail-calls.mjs <in.wasm> <out.wasm>');
  process.exit(2);
}
const buf = new Uint8Array(readFileSync(input));
let p = 0;

function u32() {
  let r = 0, shift = 0, b;
  do { b = buf[p++]; r += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return r;
}
function skipLeb() { while (buf[p++] & 0x80); }
function fail(msg) { throw new Error(`tail-calls: ${msg} at byte ${p}`); }

if (buf[0] !== 0 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) fail('not a wasm module');
p = 8;

const types = []; // result signature of each type, as a string
let funcTypes = []; // type index of each function (imports first)
let numImportedFuncs = 0;
let code = null;

while (p < buf.length) {
  const id = buf[p++];
  const size = u32();
  const end = p + size;
  if (id === 1) {
    for (let n = u32(); n > 0; n--) {
      if (buf[p++] !== 0x60) fail('unexpected type form');
      const np = u32(); p += np; // value types are single bytes in this module
      const nr = u32();
      types.push(Array.from(buf.subarray(p, p + nr)).join(','));
      p += nr;
    }
  } else if (id === 2) {
    for (let n = u32(); n > 0; n--) {
      for (let k = 0; k < 2; k++) { const len = u32(); p += len; } // module, name
      const kind = buf[p++];
      if (kind === 0) { funcTypes.push(u32()); numImportedFuncs++; }
      else if (kind === 1) { p++; const f = buf[p++]; skipLeb(); if (f & 1) skipLeb(); }
      else if (kind === 2) { const f = buf[p++]; skipLeb(); if (f & 1) skipLeb(); }
      else if (kind === 3) { p += 2; }
      else if (kind === 4) { p++; skipLeb(); }
      else fail(`unknown import kind ${kind}`);
    }
  } else if (id === 3) {
    for (let n = u32(); n > 0; n--) funcTypes.push(u32());
  } else if (id === 10) {
    code = { start: p, end };
  }
  p = end;
}
if (!code) fail('no code section');

let rewritten = 0, skippedTry = 0, skippedType = 0;
p = code.start;
const count = u32();
for (let i = 0; i < count; i++) {
  const bodySize = u32();
  const bodyEnd = p + bodySize;
  const results = types[funcTypes[numImportedFuncs + i]];
  for (let n = u32(); n > 0; n--) { skipLeb(); p++; } // locals
  // Control stack: true for a frame that is a try (or its catch).
  const ctl = [];
  let tries = 0;
  let pending = -1; // offset of the last call, if the last instruction was one
  let pendingResults = '';
  while (p < bodyEnd) {
    const at = p;
    const op = buf[p++];
    const tailHere = op === 0x0f || (op === 0x0b && ctl.length === 0);
    if (pending >= 0 && tailHere) {
      if (tries > 0) skippedTry++;
      else if (pendingResults !== results) skippedType++;
      else { buf[pending] += 2; rewritten++; } // call→return_call, call_indirect→return_call_indirect
    }
    pending = -1;
    switch (op) {
      case 0x02: case 0x03: case 0x04: // block loop if
        if (buf[p] === 0x40 || (buf[p] >= 0x6f && buf[p] <= 0x7f)) p++; else skipLeb();
        ctl.push(false);
        break;
      case 0x06: // try
        if (buf[p] === 0x40 || (buf[p] >= 0x6f && buf[p] <= 0x7f)) p++; else skipLeb();
        ctl.push(true); tries++;
        break;
      case 0x07: skipLeb(); break; // catch tag
      case 0x19: break; // catch_all
      case 0x05: break; // else
      case 0x0b: // end
        if (ctl.length > 0 && ctl.pop()) tries--;
        break;
      case 0x18: // delegate: ends a try
        skipLeb();
        if (ctl.pop()) tries--;
        break;
      case 0x08: case 0x09: skipLeb(); break; // throw tag, rethrow depth
      case 0x0c: case 0x0d: skipLeb(); break; // br br_if
      case 0x0e: for (let n = u32(); n >= 0; n--) skipLeb(); break; // br_table
      case 0x10: { // call
        const f = u32();
        if (f >= numImportedFuncs) { pending = at; pendingResults = types[funcTypes[f]]; }
        break;
      }
      case 0x11: { // call_indirect
        const t = u32(); skipLeb();
        pending = at; pendingResults = types[t];
        break;
      }
      case 0x12: skipLeb(); break; // return_call
      case 0x13: skipLeb(); skipLeb(); break; // return_call_indirect
      case 0x00: case 0x01: case 0x0f: case 0x1a: case 0x1b: case 0xd1: break;
      case 0x1c: { const n = u32(); p += n; break; } // select t*
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0xd2:
        skipLeb(); break;
      case 0xd0: p++; break; // ref.null t
      case 0x3f: case 0x40: p++; break; // memory.size/grow 0
      case 0x41: case 0x42: skipLeb(); break; // i32/i64.const
      case 0x43: p += 4; break;
      case 0x44: p += 8; break;
      case 0xfc: {
        const sub = u32();
        if (sub <= 7) break;
        if (sub === 8) { skipLeb(); p++; } // memory.init data 0
        else if (sub === 9 || sub === 13 || (sub >= 15 && sub <= 17)) skipLeb();
        else if (sub === 10) p += 2; // memory.copy 0 0
        else if (sub === 11) p++; // memory.fill 0
        else if (sub === 12 || sub === 14) { skipLeb(); skipLeb(); }
        else fail(`unknown 0xfc opcode ${sub}`);
        break;
      }
      default:
        if (op >= 0x28 && op <= 0x3e) { const a = u32(); if (a & 0x40) skipLeb(); skipLeb(); } // memarg
        else if (op >= 0x45 && op <= 0xc4) { /* numeric */ }
        else fail(`unknown opcode 0x${op.toString(16)}`);
    }
  }
  if (p !== bodyEnd || ctl.length !== 0) fail(`function ${i} did not decode cleanly`);
}

writeFileSync(output, buf);
console.log(`tail-calls: ${rewritten} calls made tail calls (${skippedTry} inside try, ${skippedType} with other result types left alone)`);
