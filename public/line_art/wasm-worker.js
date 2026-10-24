// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face, PathFace } from './line_art/pkg/line_art.js?v=20261024x';

// Fits a graph drawing to the image it is sent, one step at a time, posting the graph after every step as
// {nodes, edges, widths, dot, iteration, done}: the full graph (Face), or with kind "path" one unbroken line
// (PathFace). With kind "airbrush" the line is a soft Gaussian stroke, with kind "ridge" a soft stroke whose
// darkness falls off linearly, and with kind "learned" that ridge with its falloff radius learned too (posted
// as ridge, in pixels). Kind "twopass" draws the sharp line for all but the last BLUR_STEPS of the iterations,
// then switches to a learned ridge for those; these messages also carry image, the drawing's
// darkness per pixel exactly as the optimizer scores it. A new message starts over; the job counter stops the
// old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261024x', import.meta.url) });
let job = 0;
const BLUR_STEPS = 500;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, iterations, kind } = e.data;
  const soft = kind === "airbrush" || kind === "ridge" || kind === "learned";
  const path = kind === "path" || kind === "twopass" || soft;
  const first = kind === "twopass" ? iterations - BLUR_STEPS : iterations;
  const face = path
    ? new PathFace(darkness, width, height, nodes, first, soft, kind === "ridge" || kind === "learned" ? 3 : 0, kind === "learned")
    : new Face(darkness, width, height, nodes, iterations);
  const dot = path ? face.dot() : 1.2;
  let blurring = false;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    let done = !face.step();
    if (done && kind === "twopass" && !blurring) {
      face.blur_pass(BLUR_STEPS);
      blurring = true;
      done = false;
    }
    const image = soft || blurring ? face.shown() : undefined;
    const ridge = kind === "learned" || blurring ? face.ridge() : undefined;
    const iteration = face.iteration() + (blurring ? first : 0);
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), dot, image, ridge, iteration, done });
    if (done) face.free();
    else setTimeout(frame, 0);
  };
  frame();
};
