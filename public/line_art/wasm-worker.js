// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face, PathFace } from './line_art/pkg/line_art.js?v=20261025d';

// Fits a graph drawing to the image it is sent, one step at a time, posting the graph after every step as
// {nodes, edges, widths, dot, iteration, done}: the full graph (Face), or with kind "path" one unbroken line
// (PathFace). With kind "airbrush" the line is a soft Gaussian stroke, with kind "ridge" a soft stroke whose
// darkness falls off linearly, and with kind "learned" that ridge with its falloff radius learned too (posted
// as ridge, in pixels). Kind "twopass" draws the sharp line for all but the last BLUR_STEPS of the iterations,
// then switches to a learned ridge for those, and kind "pencil" does the same but then learns the stroke's whole
// cross-section (posted as profile, darkness at each pixel out from the centre). Kind "graphite" draws like a
// pencil in a single pass: each line as a few sharp streaks whose graphite varies along them, with no stroke
// kernel, saturating as strokes pile up, and its image is FINE times finer than the photo (posted as
// scale); these messages also carry image, the drawing's
// darkness per pixel exactly as the optimizer scores it. A new message starts over; the job counter stops the
// old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261025d', import.meta.url) });
let job = 0;
const BLUR_STEPS = 500;
const FINE = 2;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, iterations, kind } = e.data;
  const graphite = kind === "graphite";
  const soft = kind === "airbrush" || kind === "ridge" || kind === "learned" || graphite;
  const two = kind === "twopass" || kind === "pencil";
  const path = kind === "path" || two || soft;
  const first = two ? iterations - BLUR_STEPS : iterations;
  const face = path
    ? new PathFace(darkness, width, height, nodes, first, soft, kind === "ridge" || kind === "learned" ? 3 : 0, kind === "learned", graphite)
    : new Face(darkness, width, height, nodes, iterations);
  const dot = path ? face.dot() : 1.2;
  let blurring = false;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    let done = !face.step();
    if (done && two && !blurring) {
      face.blur_pass(BLUR_STEPS, kind === "pencil", kind === "graphite");
      blurring = true;
      done = false;
    }
    // a pencil drawing is rendered finer than the optimizer's pixels, so its grain shows
    const scale = graphite ? FINE : 1;
    const image = graphite ? face.shown_fine(FINE) : soft || blurring ? face.shown() : undefined;
    const ridge = kind === "learned" || (blurring && kind === "twopass") ? face.ridge() : undefined;
    const profile = blurring && kind === "pencil" ? face.profile() : undefined;
    const iteration = face.iteration() + (blurring ? first : 0);
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), dot, image, scale, ridge, profile, iteration, done });
    if (done) face.free();
    else setTimeout(frame, 0);
  };
  frame();
};
