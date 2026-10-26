// Turns a one-line face (nodes [x, y, ...] in photo pixels, edges [a, b, ...] forming one path) into G-code for
// an FDM printer (Marlin dialect: Prusa, Ender, Bambu in Marlin mode and most others). It prints a thin plate the
// size of the photo, pauses for a filament change (M600), then traces the whole face as one unbroken extrusion on
// top of the plate, rising over the line wherever it crosses itself. Lengths are in mm, temperatures in °C.
export function faceGcode(nodes, edges, width, height, {
  size = 150,              // the photo's longer side on the plate
  border = 6,              // plate beyond the photo on each side
  bed = [220, 220],        // the drawing is centred on this bed
  nozzle = 0.4,
  layer = 0.2,
  plateLayers = 3,
  lineLayers = 1,          // times over the whole path, each back along the one before
  lineWidth = 0.45,
  filament = 1.75,
  hotend = 210,
  bedTemp = 60,
  plateSpeed = 60,         // mm/s
  lineSpeed = 25,
  travelSpeed = 150,
  colourChange = true,
} = {}) {
  const order = pathOrder(nodes, edges);
  const k = size / Math.max(width, height);
  const [w, h] = [width * k, height * k];
  const [x0, y0] = [(bed[0] - w) / 2, (bed[1] - h) / 2];
  // photo pixels to bed mm, flipping y since the photo's y runs down
  const at = (i) => [x0 + nodes[2 * i] * k, y0 + h - nodes[2 * i + 1] * k];
  const ePerMm = (lw) => (lw * layer) / (Math.PI * (filament / 2) ** 2);
  const f = (v) => v.toFixed(3);
  const out = [];
  let e = 0, pos = null;
  const travel = (x, y) => { out.push(`G0 X${f(x)} Y${f(y)} F${travelSpeed * 60}`); pos = [x, y]; };
  const extrude = (x, y, lw) => {
    e += Math.hypot(x - pos[0], y - pos[1]) * ePerMm(lw);
    out.push(`G1 X${f(x)} Y${f(y)} E${e.toFixed(5)}`);
    pos = [x, y];
  };
  const lift = (z) => out.push(`G1 Z${f(z)} F600`);
  const retract = () => out.push(`G1 E${(e -= 0.8).toFixed(5)} F2400`);
  const unretract = () => out.push(`G1 E${(e += 0.8).toFixed(5)} F2400`);

  let length = 0;
  for (let j = 1; j < order.length; j++) {
    const [a, b] = [at(order[j - 1]), at(order[j])];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  out.push(
    `; One-line face: ${order.length} nodes, a ${(length / 1000).toFixed(1)} m path, ${f(w)} x ${f(h)} mm`,
    `; Plate ${plateLayers} x ${layer} mm, then ${colourChange ? "M600 colour change, then " : ""}the line in ${layer} mm beads, ${lineLayers} pass${lineLayers > 1 ? "es" : ""}`,
    "M82 ; absolute extrusion", "G21", "G90",
    `M140 S${bedTemp}`, `M104 S${hotend}`, "G28", `M190 S${bedTemp}`, `M109 S${hotend}`,
    "G92 E0",
    // prime along the front edge of the bed
    `G1 Z${f(layer)} F600`, `G0 X10 Y5 F${travelSpeed * 60}`,
  );
  pos = [10, 5];
  out.push(`G1 F${plateSpeed * 60}`);
  extrude(Math.min(bed[0] - 10, 110), 5, 0.6);

  // the plate: back-and-forth lines, each layer at right angles to the last
  const [px0, py0, px1, py1] = [x0 - border, y0 - border, x0 + w + border, y0 + h + border];
  for (let l = 0; l < plateLayers; l++) {
    const z = layer * (l + 1);
    retract(); lift(z + 0.4);
    out.push(`; plate layer ${l + 1}`);
    const across = l % 2 === 0;
    const [lo, hi] = across ? [py0, py1] : [px0, px1];
    const lines = Math.floor((hi - lo) / nozzle);
    for (let i = 0; i <= lines; i++) {
      const c = lo + ((hi - lo) * i) / lines;
      let [a, b] = across ? [[px0, c], [px1, c]] : [[c, py0], [c, py1]];
      if (i % 2) [a, b] = [b, a];
      if (i === 0) { travel(...a); lift(z); unretract(); out.push(`G1 F${(l ? plateSpeed : plateSpeed / 2) * 60}`); }
      else extrude(...a, nozzle);
      extrude(...b, nozzle);
    }
  }

  const top = layer * plateLayers;
  retract(); lift(top + 5);
  if (colourChange) out.push("; swap to the line's colour", "M600");
  // the face, one unbroken extrusion per layer, back along the path on even layers so it never travels. Where
  // the line crosses plastic it laid earlier, the nozzle rises over it: a height map of everything printed so far
  // (on a STEP mm grid) gives the highest plastic under the nozzle's tip, and the bead goes one layer above that.
  // The last CLEAR mm of the line itself are left out of that, or each bead would climb onto the one before it.
  // The nozzle's cone also has to clear taller stacks nearby: a coarser map (COARSE mm cells, each the highest
  // plastic in it) keeps the tip above any plastic within CONE mm, less a 45° slope out from the tip's edge.
  const STEP = 0.1, CLEAR = 1.0, SAMPLE = 0.2, TIP = 0.5, COARSE = 0.5, CONE = 4;
  const [gw, gh] = [Math.ceil((px1 - px0) / STEP) + 1, Math.ceil((py1 - py0) / STEP) + 1];
  const heights = new Float32Array(gw * gh), laid = new Float32Array(gw * gh).fill(-Infinity);
  const cells = (x, y, r, visit) => {
    const [cx, cy, n] = [(x - px0) / STEP, (y - py0) / STEP, Math.ceil(r / STEP)];
    for (let j = Math.max(0, Math.round(cy) - n); j <= Math.min(gh - 1, Math.round(cy) + n); j++)
      for (let i = Math.max(0, Math.round(cx) - n); i <= Math.min(gw - 1, Math.round(cx) + n); i++)
        if ((i - cx) ** 2 + (j - cy) ** 2 <= (r / STEP) ** 2) visit(j * gw + i);
  };
  let along = 0, peak = 0, last = null;
  const [cw, ch] = [Math.ceil((px1 - px0) / COARSE) + 1, Math.ceil((py1 - py0) / COARSE) + 1];
  const coarse = new Float32Array(cw * ch);
  const lay = (x, y) => {
    let under = 0;
    cells(x, y, TIP, (c) => { if (laid[c] < along - CLEAR) under = Math.max(under, heights[c]); });
    // the bead's top, where the plastic lands, and the nozzle's height, which can be higher to clear a stack
    const bead = under + layer;
    let z = bead;
    const [cx, cy, n] = [(x - px0) / COARSE, (y - py0) / COARSE, Math.ceil(CONE / COARSE)];
    for (let j = Math.max(0, Math.floor(cy) - n); j <= Math.min(ch - 1, Math.floor(cy) + n); j++)
      for (let i = Math.max(0, Math.floor(cx) - n); i <= Math.min(cw - 1, Math.floor(cx) + n); i++) {
        // the nearest a cell's plastic can be, measured from its centre less half its diagonal
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) * COARSE - COARSE * 0.71;
        if (d > TIP) z = Math.max(z, coarse[j * cw + i] - (d - TIP));
      }
    cells(x, y, lineWidth / 2, (c) => {
      heights[c] = Math.max(heights[c], bead); laid[c] = along;
      const k = Math.floor((c / gw | 0) * STEP / COARSE) * cw + Math.floor((c % gw) * STEP / COARSE);
      coarse[k] = Math.max(coarse[k], bead);
    });
    peak = Math.max(peak, bead);
    return top + z;
  };
  const extrudeTo = (x, y, z) => {
    e += Math.hypot(x - pos[0], y - pos[1]) * ePerMm(lineWidth);
    out.push(`G1 X${f(x)} Y${f(y)} Z${f(z)} E${e.toFixed(5)}`);
    pos = [x, y]; last = z;
  };
  for (let l = 0; l < lineLayers; l++) {
    const seq = l % 2 ? [...order].reverse() : order;
    out.push(`; line layer ${l + 1}`);
    if (l === 0) { travel(...at(seq[0])); lift((last = lay(...at(seq[0])))); unretract(); }
    out.push(`G1 F${lineSpeed * 60}`);
    for (let j = 1; j < seq.length; j++) {
      const [a, b] = [at(seq[j - 1]), at(seq[j])];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / SAMPLE));
      // a point every SAMPLE mm, but a move only where the height changes (from the point before, so the nozzle
      // doesn't start rising early) or the segment ends
      let held = null;
      for (let i = 1; i <= n; i++) {
        const [x, y] = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
        along += len / n;
        const z = lay(x, y);
        if (Math.abs(z - last) > 0.01) {
          if (held) extrudeTo(...held, last);
          extrudeTo(x, y, z);
          held = null;
        } else if (i === n) extrudeTo(x, y, z);
        else held = [x, y];
      }
    }
  }
  retract();
  out[0] += `, line up to ${f(peak)} mm tall`;
  out.push(`G1 Z${f(top + peak + 10)} F600`, `G0 X${f(bed[0] / 2)} Y${f(bed[1] - 10)} F${travelSpeed * 60}`,
    "M104 S0", "M140 S0", "M107", "M84", "");
  return out.join("\n");
}

// The nodes in the order the path visits them, from one end: edges hold each segment once, in any order.
export function pathOrder(nodes, edges) {
  const n = nodes.length / 2;
  const next = Array.from({ length: n }, () => []);
  for (let i = 0; i < edges.length; i += 2) {
    next[edges[i]].push(edges[i + 1]);
    next[edges[i + 1]].push(edges[i]);
  }
  let at = next.findIndex((v) => v.length === 1);
  if (at < 0) at = 0;
  const order = [at], seen = new Uint8Array(n);
  seen[at] = 1;
  for (;;) {
    const to = next[at].find((v) => !seen[v]);
    if (to === undefined) break;
    seen[to] = 1;
    order.push((at = to));
  }
  return order;
}
