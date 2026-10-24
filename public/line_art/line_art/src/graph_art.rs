// Approximates a grayscale image with a graph: a fixed set of nodes, and each pair of nodes is either joined
// by a straight line of ink or not. The loss compares the drawing to the photo after blurring both with a
// Gaussian, so a few thin lines can stand in for a patch of shading instead of having to hit single pixels.
//
// With D the ink of the drawing, T the darkness of the photo and G the blur, the loss is |G(D - T)|^2.
// Keeping E = G^T G (D - T) (one blur of the residual with sigma * sqrt(2)) makes the change in loss from
// adding or removing a line l cheap: 2 <l, E> + |G l|^2, a sum of E along the line plus a term that only
// depends on the line's length. Only accepted moves pay for re-blurring the line into E.
use rand::seq::SliceRandom;
use rand::Rng;

pub struct GraphArt {
    width: usize,
    height: usize,
    pub nodes: Vec<(f32, f32)>,
    pairs: Vec<(u16, u16)>,
    pub on: Vec<bool>,
    e: Vec<f32>,
    weight: Vec<f32>,
    kernel: Vec<f32>,
    radius: i32,
    ink: f32,
    self_per_sample: f32,
    temperature: f32,
    cooling: f32,
    order: Vec<u32>,
    cur: usize,
    shift_rate: f32,
    reach: f32,
    pub schedule: usize,
}

pub struct Params {
    pub nodes: usize,
    pub sigma: f32,
    pub ink: f32,
    pub start_temperature: f32,
    pub sweeps: f32,
    // how much harder ink on white paper is penalized than ink on the subject
    pub paper: f32,
    // unsharp-mask strength that brings out eyes, nose and mouth against the much darker hair
    pub detail: f32,
    // > 1 lightens skin and other midtones so lines avoid crossing the face
    pub gamma: f32,
    // share of proposals that move a node rather than flip a line
    pub shift_rate: f32,
}

fn blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    let r = (sigma * 3.0).ceil() as i32;
    let k: Vec<f32> = (-r..=r).map(|i| (-(i * i) as f32 / (2.0 * sigma * sigma)).exp()).collect();
    let s: f32 = k.iter().sum();
    let k: Vec<f32> = k.iter().map(|v| v / s).collect();
    let mut tmp = vec![0f32; w * h];
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut a = 0.0;
            for (i, kv) in k.iter().enumerate() {
                let xx = x as i32 + i as i32 - r;
                if xx >= 0 && xx < w as i32 {
                    a += kv * src[y * w + xx as usize];
                }
            }
            tmp[y * w + x] = a;
        }
    }
    for y in 0..h {
        for x in 0..w {
            let mut a = 0.0;
            for (i, kv) in k.iter().enumerate() {
                let yy = y as i32 + i as i32 - r;
                if yy >= 0 && yy < h as i32 {
                    a += kv * tmp[yy as usize * w + x];
                }
            }
            out[y * w + x] = a;
        }
    }
    out
}

impl GraphArt {
    // darkness: row-major, 0 = white, 1 = black
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, p: &Params, rng: &mut impl Rng) -> GraphArt {
        let soft = blur(&darkness, width, height, 4.0);
        let wide = blur(&darkness, width, height, 8.0);
        let fine: Vec<f32> = darkness.iter().zip(&wide).map(|(d, w)| d - w).collect();
        let darkness: Vec<f32> = darkness.iter().zip(&fine).map(|(d, f)| (d + p.detail * f).clamp(0.0, 1.0).powf(p.gamma)).collect();
        // nodes go where there is ink, and extra where there are features
        let detail = blur(&fine.iter().map(|f| f.abs()).collect::<Vec<_>>(), width, height, 3.0);
        let dm = detail.iter().cloned().fold(1e-6f32, f32::max);
        let sm = soft.iter().cloned().fold(1e-6f32, f32::max);
        let density: Vec<f32> = soft.iter().zip(&detail).map(|(s, d)| s / sm + 2.0 * d / dm).collect();
        let nodes = place_nodes(&density, width, height, p.nodes, rng);
        // The loss is |sqrt(W) G (D - T)|^2 with W large on paper, so stray lines across the background cost more.
        let light = blur(&darkness, width, height, 3.0);
        let weight: Vec<f32> = light.iter().map(|t| 1.0 + p.paper * (1.0 - t).powi(4)).collect();
        let n = nodes.len();
        let mut pairs = Vec::with_capacity(n * (n - 1) / 2);
        for i in 0..n {
            for j in i + 1..n {
                pairs.push((i as u16, j as u16));
            }
        }
        let s2 = p.sigma * std::f32::consts::SQRT_2;
        let radius = (s2 * 3.0).ceil() as i32;
        let mut kernel = Vec::new();
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                kernel.push((-((dx * dx + dy * dy) as f32) / (2.0 * s2 * s2)).exp());
            }
        }
        let ks: f32 = kernel.iter().sum();
        kernel.iter_mut().for_each(|v| *v /= ks);
        // E = G W G (D - T), starting from an empty drawing
        let gt = blur(&darkness, width, height, p.sigma);
        let wgt: Vec<f32> = gt.iter().zip(&weight).map(|(g, w)| -g * w).collect();
        let e = blur(&wgt, width, height, p.sigma);
        let mut order: Vec<u32> = (0..pairs.len() as u32).collect();
        order.shuffle(rng);
        // |G l|^2 for a straight line sampled once per pixel: each sample's ink times the line integral of the
        // sigma*sqrt(2) Gaussian through its centre.
        let self_per_sample = p.ink * p.ink / ((2.0 * std::f32::consts::PI).sqrt() * s2);
        let total = pairs.len() as f32 * p.sweeps;
        GraphArt {
            width,
            height,
            nodes,
            on: vec![false; pairs.len()],
            pairs,
            e,
            weight: blur(&weight, width, height, p.sigma),
            kernel,
            radius,
            ink: p.ink,
            self_per_sample,
            temperature: p.start_temperature * self_per_sample * 100.0,
            cooling: (1e-4f32).powf(1.0 / total),
            order,
            cur: 0,
            shift_rate: p.shift_rate,
            reach: 12.0,
            schedule: total as usize,
        }
    }

    // Pixels under the segment, one per unit of length.
    fn samples(&self, (x0, y0): (f32, f32), (x1, y1): (f32, f32)) -> Vec<usize> {
        let len = ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt();
        let n = len.ceil().max(1.0) as usize;
        (0..n)
            .map(|i| {
                let t = (i as f32 + 0.5) / n as f32;
                let x = (x0 + (x1 - x0) * t) as usize;
                let y = (y0 + (y1 - y0) * t) as usize;
                y * self.width + x
            })
            .collect()
    }

    fn line(&self, k: usize) -> Vec<usize> {
        let (a, b) = self.pairs[k];
        self.samples(self.nodes[a as usize], self.nodes[b as usize])
    }

    // Change in loss from adding (sign 1) or removing (sign -1) a line, given the rest of the drawing.
    fn cost(&self, pts: &[usize], sign: f32) -> f32 {
        let (mut dot, mut wsum) = (0.0, 0.0);
        for &i in pts {
            dot += self.e[i];
            wsum += self.weight[i];
        }
        2.0 * sign * self.ink * dot + wsum * self.self_per_sample
    }

    // Adds (sign 1) or removes (sign -1) a line's ink from E.
    fn stamp(&mut self, pts: &[usize], sign: f32) {
        let (w, h, r) = (self.width as i32, self.height as i32, self.radius);
        let side = (2 * r + 1) as usize;
        for &i in pts {
            // G W G l, taking W as constant across one kernel (it is a heavily blurred map)
            let amt = sign * self.ink * self.weight[i];
            let (x, y) = ((i % self.width) as i32, (i / self.width) as i32);
            for dy in -r..=r {
                let yy = y + dy;
                if yy < 0 || yy >= h {
                    continue;
                }
                let row = &self.kernel[(dy + r) as usize * side..];
                for dx in -r..=r {
                    let xx = x + dx;
                    if xx >= 0 && xx < w {
                        self.e[yy as usize * self.width + xx as usize] += amt * row[(dx + r) as usize];
                    }
                }
            }
        }
    }

    fn accept(&mut self, d: f32, rng: &mut impl Rng) -> bool {
        d < 0.0 || (self.temperature > 1e-12 && rng.gen::<f32>() < (-d / self.temperature).exp())
    }

    fn pair(&self, a: usize, b: usize) -> usize {
        let (i, j, n) = (a.min(b), a.max(b), self.nodes.len());
        i * n - i * (i + 1) / 2 + j - i - 1
    }

    // Flip the next line in a shuffled sweep.
    fn flip(&mut self, rng: &mut impl Rng) -> bool {
        let k = self.order[self.cur] as usize;
        self.cur += 1;
        if self.cur == self.order.len() {
            self.cur = 0;
            self.order.shuffle(rng);
        }
        let sign = if self.on[k] { -1.0 } else { 1.0 };
        let pts = self.line(k);
        let d = self.cost(&pts, sign);
        if !self.accept(d, rng) {
            return false;
        }
        self.on[k] = !self.on[k];
        self.stamp(&pts, sign);
        true
    }

    // Nudge one node, dragging its lines with it. With few nodes this is what lets lines line up with an
    // eye or the jaw instead of whatever the random placement allowed.
    fn shift(&mut self, rng: &mut impl Rng) -> bool {
        let v = rng.gen_range(0..self.nodes.len());
        let (x, y) = self.nodes[v];
        let r = self.reach;
        let to = (
            (x + (rng.gen::<f32>() * 2.0 - 1.0) * r).clamp(0.0, self.width as f32 - 1.0),
            (y + (rng.gen::<f32>() * 2.0 - 1.0) * r).clamp(0.0, self.height as f32 - 1.0),
        );
        let ends: Vec<usize> = (0..self.nodes.len()).filter(|&u| u != v && self.on[self.pair(u, v)]).collect();
        if ends.is_empty() {
            self.nodes[v] = to;
            return true;
        }
        let old: Vec<Vec<usize>> = ends.iter().map(|&u| self.samples(self.nodes[u], (x, y))).collect();
        let new: Vec<Vec<usize>> = ends.iter().map(|&u| self.samples(self.nodes[u], to)).collect();
        // Lines that share this node interact near it; the estimate ignores that, the update below doesn't.
        let mut d = 0.0;
        for (o, n) in old.iter().zip(&new) {
            d += self.cost(o, -1.0) + self.cost(n, 1.0);
        }
        if !self.accept(d, rng) {
            return false;
        }
        for o in &old {
            self.stamp(o, -1.0);
        }
        for n in &new {
            self.stamp(n, 1.0);
        }
        self.nodes[v] = to;
        true
    }

    // One proposal, accepted if it lowers the loss or by the Metropolis rule. Returns whether the drawing changed.
    pub fn step(&mut self, rng: &mut impl Rng) -> bool {
        let changed = if rng.gen::<f32>() < self.shift_rate { self.shift(rng) } else { self.flip(rng) };
        self.temperature *= self.cooling;
        self.reach = (self.reach * self.cooling.powf(0.25)).max(1.0);
        changed
    }

    pub fn edges(&self) -> Vec<(u16, u16)> {
        self.pairs.iter().zip(&self.on).filter(|(_, &o)| o).map(|(p, _)| *p).collect()
    }
}

// Nodes go where the picture has ink: dart throwing weighted by the blurred darkness, with a minimum spacing
// so they don't clump, relaxed whenever too many darts miss.
fn place_nodes(soft: &[f32], w: usize, h: usize, count: usize, rng: &mut impl Rng) -> Vec<(f32, f32)> {
    let max = soft.iter().cloned().fold(0f32, f32::max).max(1e-6);
    let mut spacing = ((w * h) as f32 / count as f32).sqrt() * 0.9;
    let mut nodes: Vec<(f32, f32)> = Vec::with_capacity(count);
    let mut misses = 0;
    while nodes.len() < count {
        let x = rng.gen::<f32>() * (w - 1) as f32;
        let y = rng.gen::<f32>() * (h - 1) as f32;
        let d = soft[y as usize * w + x as usize] / max;
        if rng.gen::<f32>() > d {
            continue;
        }
        if nodes.iter().any(|&(a, b)| (a - x).powi(2) + (b - y).powi(2) < spacing * spacing) {
            misses += 1;
            if misses > 200 {
                spacing *= 0.95;
                misses = 0;
            }
            continue;
        }
        nodes.push((x, y));
    }
    nodes
}
