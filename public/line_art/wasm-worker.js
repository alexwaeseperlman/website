// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face } from './line_art/pkg/line_art.js?v=20261024d';

// Fits a graph drawing to the image it is sent by gradient descent, posting {nodes, edges, widths, done}
// every frame. A new message starts over; the job counter stops the old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261024d', import.meta.url) });
const SECONDS = 6; // how long the descent should take to watch
let job = 0;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, sigma, lambda } = e.data;
  const face = new Face(darkness, width, height, nodes, sigma, lambda);
  const schedule = face.schedule();
  const perFrame = Math.ceil(schedule / (SECONDS * 60));
  let spent = 0;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    const t0 = performance.now();
    face.run(perFrame);
    spent += perFrame;
    const done = spent >= schedule;
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), done });
    if (done) face.free();
    else setTimeout(frame, Math.max(0, 16 - (performance.now() - t0)));
  };
  frame();
};
