// Starts a worker that draws `img` as a graph: straight lines of varying width between a set of nodes.
// onGraph gets (nodes [x, y, ...], edges [a, b, ...], widths [w, ...], done, iteration) after every
// optimizer step, where a width is ink per unit length; post the returned message to the worker to start over.
export function lineArt(img, onGraph, { nodes = 300, iterations = 1000 } = {}) {
  const worker = new Worker(new URL("./wasm-worker.js?v=20261024i", import.meta.url), { type: "module" });
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
  worker.onmessage = (e) => onGraph(e.data.nodes, e.data.edges, e.data.widths, e.data.done, e.data.iteration);
  const message = { darkness, width, height, nodes, iterations };
  worker.postMessage(message);
  return [worker, message];
}

// Draws the latest graph the worker sent, exactly as it stands, onto a canvas whose CSS size is the image's,
// at the screen's pixel density. A line of width w (ink per unit length) is a solid black stroke
// w px wide, and every node gets a dot. Updates that
// arrive faster than the screen refreshes are drawn once, at the next frame, showing the newest.
export function graphView(canvas, width, height) {
  let latest = null, raf = 0;

  function draw() {
    raf = 0;
    const { nodes, edges, widths } = latest;
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
    for (let i = 0; i < widths.length; i++) {
      const a = edges[2 * i] * 2, b = edges[2 * i + 1] * 2;
      // solid black, as wide as its ink per unit length; below a device pixel, thin the line by opacity
      // instead, which antialiasing does more evenly
      const px = widths[i];
      if (!(px > 0)) continue;
      ctx.lineWidth = Math.max(px, 1 / dpr);
      ctx.globalAlpha = Math.min(1, px * dpr);
      ctx.beginPath();
      ctx.moveTo(nodes[a], nodes[a + 1]);
      ctx.lineTo(nodes[b], nodes[b + 1]);
      ctx.stroke();
    }
    // a dot on every node, the same ink (pi * 1.2^2) the optimizer counts
    ctx.globalAlpha = 1;
    ctx.fillStyle = "black";
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i += 2) {
      ctx.moveTo(nodes[i] + 1.2, nodes[i + 1]);
      ctx.arc(nodes[i], nodes[i + 1], 1.2, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  return {
    update(nodes, edges, widths) {
      latest = { nodes, edges, widths };
      if (!raf) raf = requestAnimationFrame(draw);
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      latest = null;
    },
  };
}
