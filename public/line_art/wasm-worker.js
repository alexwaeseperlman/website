import init, { Face } from './line_art/pkg/line_art.js';

// Anneals a graph drawing of the image it is sent, posting {nodes, edges, done} every frame. A new message
// starts over; the job counter stops the old loop.
const ready = init();
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
    const accepted = face.run(perFrame);
    spent += perFrame;
    // past the cooling schedule it is a plain descent: stop after a whole pass changes nothing
    quiet = accepted ? 0 : quiet + perFrame;
    const done = spent > schedule && quiet >= sweep;
    postMessage({ nodes: face.nodes(), edges: face.edges(), ink, done });
    if (done) face.free();
    else setTimeout(frame, 16);
  };
  frame();
};
