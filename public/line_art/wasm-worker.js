// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face, PathFace } from './line_art/pkg/line_art.js?v=20261024v';

// Fits a graph drawing to the image it is sent, one step at a time, posting the graph after every step as
// {nodes, edges, widths, dot, iteration, done}: the full graph (Face), or with kind "path" one unbroken line
// (PathFace). With kind "airbrush" the line is a soft Gaussian stroke, with kind "ridge" a soft stroke whose
// darkness falls off linearly, and with kind "learned" that ridge with its falloff radius learned too (posted
// as ridge, in pixels); these messages also carry image, the drawing's
// darkness per pixel exactly as the optimizer scores it. A new message starts over; the job counter stops the
// old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261024v', import.meta.url) });
let job = 0;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, iterations, kind } = e.data;
  const soft = kind === "airbrush" || kind === "ridge" || kind === "learned";
  const path = kind === "path" || soft;
  const face = path
    ? new PathFace(darkness, width, height, nodes, iterations, soft, kind === "ridge" || kind === "learned" ? 3 : 0, kind === "learned")
    : new Face(darkness, width, height, nodes, iterations);
  const dot = path ? face.dot() : 1.2;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    const done = !face.step();
    const image = soft ? face.shown() : undefined;
    const ridge = kind === "learned" ? face.ridge() : undefined;
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), dot, image, ridge, iteration: face.iteration(), done });
    if (done) face.free();
    else setTimeout(frame, 0);
  };
  frame();
};
