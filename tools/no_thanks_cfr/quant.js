// Squeezes a net's weights to one signed byte each (one scale per layer's weights and one per its biases), so the
// same bytes can ship to the page and the database. node quant.js in.json out.json  -> also prints base64 size
'use strict';
const W = require(require('path').resolve(process.argv[2]));
const net = W.arch === 'pnet' ? new (require('./pnet').PNet)(W.out) : new (require('./structnet').StructNet)(W.out); net.p.set(W.p);
const bytes = new Int8Array(net.n), scales = [];
for (const L of net.L) for (const [o, len] of [[L.w, L.i * L.o], [L.b, L.o]]){
  let m = 0; for (let k = 0; k < len; k++) m = Math.max(m, Math.abs(net.p[o + k]));
  const s = m / 127 || 1; scales.push(+s.toPrecision(6));
  for (let k = 0; k < len; k++) bytes[o + k] = Math.round(net.p[o + k] / scales[scales.length - 1]);
}
const b64 = Buffer.from(bytes.buffer).toString('base64');
require('fs').writeFileSync(process.argv[3], JSON.stringify({ arch: W.arch, out: W.out, scales, q: b64 }));
// a float version of the quantized weights, for testing
const deq = Array.from(bytes); let i = 0;
for (const L of net.L) for (const [o, len] of [[L.w, L.i * L.o], [L.b, L.o]]){ const s = scales[i++]; for (let k = 0; k < len; k++) deq[o + k] = bytes[o + k] * s; }
require('fs').writeFileSync(process.argv[3].replace('.json', '-deq.json'), JSON.stringify({ arch: W.arch, out: W.out, p: deq }));
console.log('weights', net.n, 'base64 chars', b64.length);
