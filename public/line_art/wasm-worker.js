// The ?v= queries keep a browser from pairing this with a cached copy of the old line art JS or wasm, which
// sat at the same paths. Bump the version (here, in line_art.js and in ../index.html) whenever pkg/ is rebuilt.
import init, { Face, PathFace } from './line_art/pkg/line_art.js?v=20261024r';

// Fits a graph drawing to the image it is sent, one step at a time, posting the graph after every step as
// {nodes, edges, widths, dot, iteration, done}: the full graph (Face), or with kind "path" one unbroken line
// (PathFace). With kind "airbrush" the line is a soft stroke, and messages also carry image, the drawing's
// darkness per pixel exactly as the optimizer scores it. A new message starts over; the job counter stops the
// old loop.
const ready = init({ module_or_path: new URL('./line_art/pkg/line_art_bg.wasm?v=20261024r', import.meta.url) });
let job = 0;

onmessage = async (e) => {
  const id = ++job;
  await ready;
  if (id !== job) return;
  const { darkness, width, height, nodes, iterations, kind } = e.data;
  const path = kind === "path" || kind === "airbrush";
  const face = path ? new PathFace(darkness, width, height, nodes, iterations, kind === "airbrush") : new Face(darkness, width, height, nodes, iterations);
  const dot = path ? face.dot() : 1.2;
  const frame = () => {
    if (id !== job) { face.free(); return; }
    const done = !face.step();
    const image = kind === "airbrush" ? face.shown() : undefined;
    postMessage({ nodes: face.nodes(), edges: face.edges(), widths: face.widths(), dot, image, iteration: face.iteration(), done });
    if (done) face.free();
    else setTimeout(frame, 0);
  };
  frame();
};
