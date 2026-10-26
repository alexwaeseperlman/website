// Turns a one-line face (nodes [x, y, ...] in photo pixels, edges [a, b, ...] forming one path) into G-code for
// an FDM printer (Marlin dialect: Prusa, Ender, Bambu in Marlin mode and most others). It prints a thin plate the
// size of the photo, pauses for a filament change (M600), then traces the whole face as one unbroken extrusion,
// `lineLayers` layers tall, on top of the plate. Lengths are in mm, temperatures in °C.
export function faceGcode(nodes, edges, width, height, {
  size = 150,              // the photo's longer side on the plate
  border = 6,              // plate beyond the photo on each side
  bed = [220, 220],        // the drawing is centred on this bed
  nozzle = 0.4,
  layer = 0.2,
  plateLayers = 3,
  lineLayers = 2,
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
    `; Plate ${plateLayers} x ${layer} mm, then ${colourChange ? "M600 colour change, then " : ""}the line ${lineLayers} x ${layer} mm`,
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
  // the face, one unbroken extrusion per layer, back along the path on even layers so it never travels
  for (let l = 0; l < lineLayers; l++) {
    const z = top + layer * (l + 1);
    const seq = l % 2 ? [...order].reverse() : order;
    out.push(`; line layer ${l + 1}`);
    if (l === 0) { travel(...at(seq[0])); lift(z); unretract(); }
    else lift(z);
    out.push(`G1 F${lineSpeed * 60}`);
    for (let j = 1; j < seq.length; j++) extrude(...at(seq[j]), lineWidth);
  }
  retract();
  out.push(`G1 Z${f(top + layer * lineLayers + 10)} F600`, `G0 X${f(bed[0] / 2)} Y${f(bed[1] - 10)} F${travelSpeed * 60}`,
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
