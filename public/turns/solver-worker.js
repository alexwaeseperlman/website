// Runs the Turns solver (tools/turns-solver/turns.cpp, built as solver.wasm) off the main thread.
// Message in: the solver's stdin text. Message out: { out, err, code } or { error }.
function runSolver(module, input){
  const stdin = new TextEncoder().encode(input); let pos = 0, mem = null;
  const out = ['', '', ''], dec = new TextDecoder();
  const dv = () => new DataView(mem.buffer);
  const wasi = {
    environ_get: () => 0,
    environ_sizes_get: (pc, ps) => { dv().setUint32(pc, 0, true); dv().setUint32(ps, 0, true); return 0; },
    fd_fdstat_get: (fd, p) => { const d = dv(); d.setUint8(p, 2); d.setUint16(p+2, 0, true); d.setBigUint64(p+8, 0n, true); d.setBigUint64(p+16, 0n, true); return 0; },
    fd_close: () => 0,
    fd_seek: () => 70,   // ESPIPE: stdin and stdout are streams
    fd_read: (fd, iovs, n, pn) => {
      const d = dv(); let got = 0;
      for (let i=0;i<n;i++){
        const ptr = d.getUint32(iovs+i*8, true), len = d.getUint32(iovs+i*8+4, true), take = Math.min(len, stdin.length-pos);
        new Uint8Array(mem.buffer, ptr, take).set(stdin.subarray(pos, pos+take)); pos += take; got += take;
        if (take < len) break;
      }
      d.setUint32(pn, got, true); return 0;
    },
    fd_write: (fd, iovs, n, pn) => {
      const d = dv(); let put = 0;
      for (let i=0;i<n;i++){
        const ptr = d.getUint32(iovs+i*8, true), len = d.getUint32(iovs+i*8+4, true);
        out[fd === 2 ? 2 : 1] += dec.decode(new Uint8Array(mem.buffer, ptr, len).slice()); put += len;
      }
      d.setUint32(pn, put, true); return 0;
    },
    proc_exit: code => { throw { exit: code }; }
  };
  const inst = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
  mem = inst.exports.memory;
  let code = 0;
  try{ inst.exports._start(); }
  catch(e){ if (e && typeof e.exit === 'number') code = e.exit; else return { error: String(e && e.message || e), out: out[1], err: out[2] }; }
  return { out: out[1], err: out[2], code };
}
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope){
  let modP = null;
  onmessage = async e => {
    try{
      if (!modP) modP = fetch('solver.wasm?v=2').then(r => { if (!r.ok) throw new Error('Could not load the solver.'); return r.arrayBuffer(); }).then(b => WebAssembly.compile(b));
      postMessage(runSolver(await modP, e.data));
    }catch(err){ modP = null; postMessage({ error: String(err && err.message || err) }); }
  };
}
if (typeof module !== 'undefined') module.exports = { runSolver };
