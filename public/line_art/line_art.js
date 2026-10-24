// Starts a worker that draws `img` as a graph: straight lines between a fixed set of nodes. onGraph gets
// (nodes [x, y, ...], edges [a, b, ...], ink, done) every frame; post the returned message to the worker
// to start over.
export function lineArt(img, onGraph, { nodes = 220, sigma = 2, ink = 0.15 } = {}) {
  const worker = new Worker(new URL("./wasm-worker.js?v=20261024c", import.meta.url), { type: "module" });
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

// Draws the graphs the worker sends onto a canvas whose CSS size is the image's, at the screen's pixel
// density, easing between them so it glides instead of jumping: lines fade in and out and nodes slide to
// their new places. Each line is its own stroke so crossings get darker, like the ink the optimizer assumed.
export function graphView(canvas, width, height) {
  const EASE_MS = 180;
  let target = null, pos = null, ink = 0, raf = 0, last = 0;
  const shown = new Map(); // edge key -> opacity 0..1
  const key = (a, b) => a * 65536 + b;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (const [k, o] of shown) {
      const a = Math.floor(k / 65536) * 2, b = (k % 65536) * 2;
      ctx.globalAlpha = ink * o;
      ctx.beginPath();
      ctx.moveTo(pos[a], pos[a + 1]);
      ctx.lineTo(pos[b], pos[b + 1]);
      ctx.stroke();
    }
  }

  function tick(t) {
    const f = 1 - Math.exp(-(last ? t - last : 16) / EASE_MS);
    last = t;
    let moving = false;
    for (let i = 0; i < pos.length; i++) {
      const d = target.nodes[i] - pos[i];
      if (Math.abs(d) > 0.02) { pos[i] += d * f; moving = true; } else pos[i] = target.nodes[i];
    }
    for (const [k, o] of shown) {
      const want = target.on.has(k) ? 1 : 0;
      const next = o + (want - o) * f;
      if (Math.abs(want - next) > 0.01) { shown.set(k, next); moving = true; }
      else if (want) shown.set(k, 1);
      else shown.delete(k);
    }
    draw();
    raf = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) last = 0;
  }

  return {
    update(nodes, edges, inkValue) {
      ink = inkValue;
      target = { nodes, on: new Set() };
      for (let i = 0; i < edges.length; i += 2) {
        const k = key(edges[i], edges[i + 1]);
        target.on.add(k);
        if (!shown.has(k)) shown.set(k, 0);
      }
      if (!pos || pos.length !== nodes.length) pos = Float32Array.from(nodes);
      if (!raf) raf = requestAnimationFrame(tick);
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      pos = null;
      shown.clear();
    },
  };
}
