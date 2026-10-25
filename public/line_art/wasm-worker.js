// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face, PathFace } from './line_art/pkg/line_art.js?v=20261025j';

// Fits a graph drawing to the image it is sent, one step at a time, posting the graph after every step as
// {nodes, edges, widths, dot, iteration, done}: the full graph (Face), or with kind "path" one unbroken line
// (PathFace). With kind "airbrush" the line is a soft Gaussian stroke, with kind "ridge" a soft stroke whose
// darkness falls off linearly, and with kind "learned" that ridge with its falloff radius learned too (posted
// as ridge, in pixels). Kind "twopass" draws the sharp line for all but the last BLUR_STEPS of the iterations,
// then switches to a learned ridge for those, and kind "pencil" does the same but then learns the stroke's whole
// cross-section (posted as profile, darkness at each pixel out from the centre). Kind "graphite" draws like a
// pencil in a single pass: each line as a few sharp streaks whose graphite varies along them, with no stroke
// kernel, saturating as strokes pile up; it posts the seed of its streaks, from which the page draws it, and
// each step in PARTS posts; the other soft strokes' messages also carry image, the drawing's
// darkness per pixel exactly as the optimizer scores it. A new message starts over; the job counter stops the
// old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261025j', import.meta.url) });
let job = 0;
// Runs f as soon as the worker is free: a message to itself, as nested setTimeout(0)s are held back 4 ms each,
// which at a few thousand posts a run adds seconds
const channel = new MessageChannel();
let pending = null;
channel.port1.onmessage = () => { const f = pending; pending = null; f(); };
const next = (f) => { pending = f; channel.port2.postMessage(0); };
const BLUR_STEPS = 500;
// a pencil step is shown in this many parts, its annealing as it goes
const PARTS = 3;

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
    let done = !(graphite ? face.step_part(PARTS) : face.step());
    if (done && two && !blurring) {
      face.blur_pass(BLUR_STEPS, kind === "pencil");
      blurring = true;
      done = false;
    }
    // a pencil drawing is drawn by the page from the nodes, the path and the seed of its streaks
    const image = soft && !graphite || blurring ? face.shown() : undefined;
    const seed = graphite ? face.seed() : undefined;
    const ridge = kind === "learned" || (blurring && kind === "twopass") ? face.ridge() : undefined;
    const profile = blurring && kind === "pencil" ? face.profile() : undefined;
    const iteration = face.iteration() + (blurring ? first : 0);
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), dot, image, seed, ridge, profile, iteration, done });
    if (done) face.free();
    else next(frame);
  };
  frame();
};
