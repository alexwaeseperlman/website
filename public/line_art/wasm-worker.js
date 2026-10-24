// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face } from './line_art/pkg/line_art.js?v=20261024c';

// Anneals a graph drawing of the image it is sent, posting {nodes, edges, done} every frame. A new message
// starts over; the job counter stops the old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261024c', import.meta.url) });
const SECONDS = 6; // how long the cooling should take to watch
let job = 0;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, sigma, ink } = e.data;
  const face = new Face(darkness, width, height, nodes, sigma, ink);
  const sweep = face.sweep(), schedule = face.schedule();
  const perFrame = Math.ceil(schedule / (SECONDS * 60));
  let spent = 0, quiet = 0;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    const t0 = performance.now();
    const accepted = face.run(perFrame);
    spent += perFrame;
    // past the cooling schedule it is a plain descent: stop after a whole pass changes nothing, or after two
    // passes anyway, since a few lines can keep flipping on rounding differences
    quiet = accepted ? 0 : quiet + perFrame;
    const done = spent > schedule && (quiet >= sweep || spent > schedule + 2 * sweep);
    postMessage({ nodes: face.nodes(), edges: face.edges(), ink, done });
    if (done) face.free();
    else setTimeout(frame, Math.max(0, 16 - (performance.now() - t0)));
  };
  frame();
};
