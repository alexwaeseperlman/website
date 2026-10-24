// Starts a worker that draws `img` as a graph: straight lines between a fixed set of nodes. onGraph gets
// (nodes [x, y, ...], edges [a, b, ...], ink, done) every frame; post the returned message to the worker
// to start over.
export function lineArt(img, onGraph, { nodes = 170, sigma = 2, ink = 0.3 } = {}) {
  const worker = new Worker("/line_art/wasm-worker.js", { type: "module" });
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;
  const darkness = new Float32Array(width * height);
  for (let i = 0; i < darkness.length; i++) {
    darkness[i] = 1 - (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / (3 * 255);
  }
  worker.onmessage = (e) => onGraph(e.data.nodes, e.data.edges, e.data.ink, e.data.done);
  const message = { darkness, width, height, nodes, sigma, ink };
  worker.postMessage(message);
  return [worker, message];
}

// Draws the graph onto a canvas whose CSS size is the image's, at the screen's pixel density. Each line is
// its own stroke so crossings get darker, like the ink the optimizer assumed.
export function drawGraph(canvas, width, height, nodes, edges, ink) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = `rgba(0, 0, 0, ${ink})`;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i] * 2, b = edges[i + 1] * 2;
    ctx.beginPath();
    ctx.moveTo(nodes[a], nodes[a + 1]);
    ctx.lineTo(nodes[b], nodes[b + 1]);
    ctx.stroke();
  }
}
