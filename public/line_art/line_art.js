// Starts a worker that draws `img` as a graph: straight lines of varying width between a set of nodes.
// onGraph gets (nodes [x, y, ...], edges [a, b, ...], widths [w, ...], done) every frame, where a width is
// ink per unit length; post the returned message to the worker to start over.
export function lineArt(img, onGraph, { nodes = 300, sigma = 2, lambda = 0.02 } = {}) {
  const worker = new Worker(new URL("./wasm-worker.js?v=20261024d", import.meta.url), { type: "module" });
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
  worker.onmessage = (e) => onGraph(e.data.nodes, e.data.edges, e.data.widths, e.data.done);
  const message = { darkness, width, height, nodes, sigma, lambda };
  worker.postMessage(message);
  return [worker, message];
}

// Draws the graphs the worker sends onto a canvas whose CSS size is the image's, at the screen's pixel
// density, easing between them so it glides instead of jumping: line widths grow and shrink and nodes slide
// to their new places. A line of width w (ink per unit length) is stroked w / ALPHA px wide at ALPHA opacity,
// each line its own stroke so crossings get darker, like the ink the optimizer assumed.
export function graphView(canvas, width, height) {
  const EASE_MS = 180, ALPHA = 0.5;
  let target = null, pos = null, raf = 0, last = 0;
  const shown = new Map(); // edge key -> width on screen
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
    ctx.lineCap = "round";
    for (const [k, w] of shown) {
      const a = Math.floor(k / 65536) * 2, b = (k % 65536) * 2;
      // below a device pixel, thin the line by opacity instead, which antialiasing does more evenly
      const px = w / ALPHA;
      ctx.lineWidth = Math.max(px, 1 / dpr);
      ctx.globalAlpha = ALPHA * Math.min(1, px * dpr);
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
    for (const [k, w] of shown) {
      const want = target.widths.get(k) || 0;
      const next = w + (want - w) * f;
      if (Math.abs(want - next) > 0.003) { shown.set(k, next); moving = true; }
      else if (want) shown.set(k, want);
      else shown.delete(k);
    }
    draw();
    raf = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) last = 0;
  }

  return {
    update(nodes, edges, widths) {
      target = { nodes, widths: new Map() };
      for (let i = 0; i < edges.length; i += 2) {
        const k = key(edges[i], edges[i + 1]);
        target.widths.set(k, widths[i / 2]);
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
