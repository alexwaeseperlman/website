// Starts a worker that draws `img` as a graph: straight lines of varying width between a set of nodes, or with
// kind "path", one unbroken line through all of them, or with kind "airbrush" (Gaussian), "ridge" (linear
// falloff) or "learned" (a ridge whose falloff radius is learned) that line as a soft stroke.
// onGraph gets (nodes [x, y, ...], edges [a, b, ...], widths [w, ...], done, iteration, dot, image, ridge, profile) after
// every optimizer step, where a width is ink per unit length, dot is the radius of the dot on each node and image
// (soft strokes only) is the drawing's darkness per pixel, and ridge (learned only) the learned radius in px;
// post the returned message to the worker to start over.
export function lineArt(img, onGraph, { nodes = 300, iterations = 1000, kind = "graph" } = {}) {
  const worker = new Worker(new URL("./wasm-worker.js?v=20261024z", import.meta.url), { type: "module" });
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
  worker.onmessage = (e) => onGraph(e.data.nodes, e.data.edges, e.data.widths, e.data.done, e.data.iteration, e.data.dot, e.data.image, e.data.ridge, e.data.profile);
  const message = { darkness, width, height, nodes, iterations, kind };
  worker.postMessage(message);
  return [worker, message];
}

// Draws the latest graph the worker sent, exactly as it stands, onto a canvas whose CSS size is the image's,
// at the screen's pixel density. A line of width w (ink per unit length) is a solid black stroke
// w px wide, and every node gets a dot. Updates that
// arrive faster than the screen refreshes are drawn once, at the next frame, showing the newest.
export function graphView(canvas, width, height) {
  let latest = null, raf = 0, buffer = null;

  function draw() {
    raf = 0;
    const { nodes, edges, widths, dot, image } = latest;
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
    if (image) {
      // an airbrushed drawing: show the optimizer's own picture of it, one value per photo pixel
      const pixels = new ImageData(width, height);
      for (let i = 0; i < image.length; i++) {
        const v = 255 * (1 - Math.min(1, Math.max(0, image[i])));
        pixels.data[4 * i] = pixels.data[4 * i + 1] = pixels.data[4 * i + 2] = v;
        pixels.data[4 * i + 3] = 255;
      }
      if (!buffer) buffer = new OffscreenCanvas(width, height);
      buffer.getContext("2d").putImageData(pixels, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(buffer, 0, 0, width, height);
      return;
    }
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
    // a dot on every node, the same ink (pi * dot^2) the optimizer counts
    ctx.globalAlpha = 1;
    ctx.fillStyle = "black";
    ctx.beginPath();
    for (let i = 0; i < nodes.length; i += 2) {
      ctx.moveTo(nodes[i] + dot, nodes[i + 1]);
      ctx.arc(nodes[i], nodes[i + 1], dot, 0, 2 * Math.PI);
    }
    ctx.fill();
  }

  return {
    update(nodes, edges, widths, dot = 1.2, image) {
      latest = { nodes, edges, widths, dot, image };
      if (!raf) raf = requestAnimationFrame(draw);
    },
    clear() {
      cancelAnimationFrame(raf);
      raf = 0;
      latest = null;
    },
  };
}
