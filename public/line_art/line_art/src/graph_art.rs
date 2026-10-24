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

const PROFILE_RES: f32 = 32.0;

pub struct GraphArt {
    width: usize,
    height: usize,
    pub nodes: Vec<(f32, f32)>,
    pairs: Vec<(u16, u16)>,
    pub on: Vec<bool>,
    e: Vec<f32>,
    weight: Vec<f32>,
    radius: i32,
    ink: f32,
    self_per_sample: f32,
    temperature: f32,
    cooling: f32,
    order: Vec<u32>,
    cur: usize,
    shift_rate: f32,
    steps: Vec<f32>,
    // exp(-d^2 / 2 sigma2^2) for d = 0, 1/PROFILE_RES, ... up to the stamp radius
    profile: Vec<f32>,
    sigma2: f32,
    pub schedule: usize,
    steps_taken: usize,
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
    // extra loss weight on detailed areas
    pub features: f32,
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
        // The loss is |sqrt(W) G (D - T)|^2 with W large on paper, so stray lines across the background cost more,
        let light = blur(&darkness, width, height, 3.0);
        // and larger again where the photo has detail (eyes, brows, nose, mouth), which is what reads as a likeness
        let weight: Vec<f32> = light.iter().zip(&detail).map(|(t, d)| 1.0 + p.paper * (1.0 - t).powi(4) + p.features * d / dm).collect();
        let n = nodes.len();
        let mut pairs = Vec::with_capacity(n * (n - 1) / 2);
        for i in 0..n {
            for j in i + 1..n {
                pairs.push((i as u16, j as u16));
            }
        }
        let s2 = p.sigma * std::f32::consts::SQRT_2;
        let radius = (s2 * 2.5).ceil() as i32;
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
            radius,
            ink: p.ink,
            self_per_sample,
            temperature: p.start_temperature * self_per_sample * 100.0,
            cooling: (1e-4f32).powf(1.0 / total),
            order,
            cur: 0,
            shift_rate: p.shift_rate,
            steps: vec![2.0; n],
            sigma2: s2,
            profile: (0..=(radius as f32 * PROFILE_RES) as usize + 1).map(|i| { let d = i as f32 / PROFILE_RES; (-d * d / (2.0 * s2 * s2)).exp() }).collect(),
            schedule: total as usize,
            steps_taken: 0,
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

    // Adds (sign 1) or removes (sign -1) the line from a to b in E. G W G l is taken in closed form: across the
    // line, the line integral of a Gaussian is a 1D Gaussian of the distance; along it, erf terms fade the ends.
    // That only touches a band of pixels around the line instead of a full kernel per pixel of it. W is taken
    // as constant across the band (it is a heavily blurred map).
    fn stamp(&mut self, a: (f32, f32), b: (f32, f32), sign: f32) {
        let (s, r) = (self.sigma2, self.radius as f32);
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = (dx * dx + dy * dy).sqrt().max(1e-3);
        let (ux, uy) = (dx / len, dy / len);
        let amp = sign * self.ink / ((2.0 * std::f32::consts::PI).sqrt() * s);
        let inv = 1.0 / (std::f32::consts::SQRT_2 * s);
        // walk the major axis, and for each step the minor-axis pixels within r of the line
        let steep = dy.abs() > dx.abs();
        let (a_maj, a_min, d_maj, d_min, n_maj, n_min) =
            if steep { (a.1, a.0, dy, dx, self.height, self.width) } else { (a.0, a.1, dx, dy, self.width, self.height) };
        let slope = if d_maj != 0.0 { d_min / d_maj } else { 0.0 };
        let hw = r * (1.0 + slope * slope).sqrt() + 1.0;
        let m0 = ((a_maj.min(a_maj + d_maj) - r).floor() as i32).max(0);
        let m1 = ((a_maj.max(a_maj + d_maj) + r).ceil() as i32).min(n_maj as i32 - 1);
        for m in m0..=m1 {
            let mc = m as f32 + 0.5;
            let t = if d_maj != 0.0 { ((mc - a_maj) / d_maj).clamp(0.0, 1.0) } else { 0.0 };
            let c = a_min + d_min * t;
            let k0 = ((c - hw).floor() as i32).max(0);
            let k1 = ((c + hw).ceil() as i32).min(n_min as i32 - 1);
            for k in k0..=k1 {
                let (px, py) = if steep { (k as f32 + 0.5, mc) } else { (mc, k as f32 + 0.5) };
                let (rx, ry) = (px - a.0, py - a.1);
                let perp = rx * uy - ry * ux;
                if perp.abs() > r {
                    continue;
                }
                let along = rx * ux + ry * uy;
                let ends = if along > r && along < len - r { 1.0 } else { 0.5 * (erf(along * inv) - erf((along - len) * inv)) };
                let i = if steep { m as usize * self.width + k as usize } else { k as usize * self.width + m as usize };
                let profile = self.profile[(perp.abs() * PROFILE_RES) as usize];
                self.e[i] += amp * profile * ends * self.weight[i];
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
        let (i, j) = self.pairs[k];
        self.stamp(self.nodes[i as usize], self.nodes[j as usize], sign);
        true
    }

    // E at a point between pixel centres, and its gradient, by bilinear interpolation.
    fn e_at(&self, x: f32, y: f32) -> (f32, f32, f32) {
        let x = x.clamp(0.0, (self.width - 2) as f32);
        let y = y.clamp(0.0, (self.height - 2) as f32);
        let (x0, y0) = (x as usize, y as usize);
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let i = y0 * self.width + x0;
        let (a, b, c, d) = (self.e[i], self.e[i + 1], self.e[i + self.width], self.e[i + self.width + 1]);
        let top = a + (b - a) * fx;
        let bottom = c + (d - c) * fx;
        let gx = (b - a) * (1.0 - fy) + (d - c) * fy;
        (top + (bottom - top) * fy, gx, bottom - top)
    }

    // Gradient of the loss with respect to node v's position, through every line attached to it. A line from u
    // to v puts ink * len * mean(E) into the loss's linear term; moving v drags each point at fraction t of the
    // way by t, and stretches the line, which adds E at its length and to the self term.
    fn node_gradient(&self, v: usize, ends: &[usize]) -> (f32, f32) {
        let (vx, vy) = self.nodes[v];
        let (mut gx, mut gy) = (0.0, 0.0);
        for &u in ends {
            let (ux, uy) = self.nodes[u];
            let (dx, dy) = (vx - ux, vy - uy);
            let len = (dx * dx + dy * dy).sqrt().max(1e-3);
            let n = len.ceil().max(1.0) as usize;
            let (mut mean, mut tx, mut ty) = (0.0, 0.0, 0.0);
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                let (e, ex, ey) = self.e_at(ux + dx * t, uy + dy * t);
                mean += e;
                tx += ex * t;
                ty += ey * t;
            }
            mean /= n as f32;
            let w = self.weight[vy as usize * self.width + vx as usize];
            let stretch = 2.0 * self.ink * mean + w * self.self_per_sample;
            gx += 2.0 * self.ink * len * tx / n as f32 + stretch * dx / len;
            gy += 2.0 * self.ink * len * ty / n as f32 + stretch * dy / len;
        }
        (gx, gy)
    }

    // Change in loss from moving a line's end from `from` (pixels `old`) to pixels `new`. Removing then adding
    // with the same E would charge the new line for overlapping the old one it replaces, so add back that
    // overlap: each new pixel's blurred ink against the old line, taken as an infinite line at its distance.
    fn moved_cost(&self, (ax, ay): (f32, f32), (bx, by): (f32, f32), old: &[usize], new: &[usize]) -> f32 {
        let (dx, dy) = (bx - ax, by - ay);
        let l2 = (dx * dx + dy * dy).max(1e-6);
        let mut overlap = 0.0;
        for &i in new {
            let (px, py) = ((i % self.width) as f32 + 0.5, (i / self.width) as f32 + 0.5);
            let t = (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0);
            let d2 = (px - ax - dx * t).powi(2) + (py - ay - dy * t).powi(2);
            overlap += self.weight[i] * (-d2 / (2.0 * self.sigma2 * self.sigma2)).exp();
        }
        self.cost(old, -1.0) + self.cost(new, 1.0) - 2.0 * self.self_per_sample * overlap
    }

    // Gradient descent on one node, dragging its lines with it. With few nodes this is what lets lines line up
    // with an eye or the jaw instead of whatever the random placement allowed. Each node keeps its own step
    // length, grown after a step that lowers the loss and halved after one that doesn't.
    fn shift(&mut self, rng: &mut impl Rng) -> bool {
        let v = rng.gen_range(0..self.nodes.len());
        let ends: Vec<usize> = (0..self.nodes.len()).filter(|&u| u != v && self.on[self.pair(u, v)]).collect();
        if ends.is_empty() {
            return false;
        }
        let (gx, gy) = self.node_gradient(v, &ends);
        let g = (gx * gx + gy * gy).sqrt();
        if g < 1e-9 {
            return false;
        }
        let (x, y) = self.nodes[v];
        let step = self.steps[v];
        let to = (
            (x - gx / g * step).clamp(0.0, self.width as f32 - 1.0),
            (y - gy / g * step).clamp(0.0, self.height as f32 - 1.0),
        );
        let old: Vec<Vec<usize>> = ends.iter().map(|&u| self.samples(self.nodes[u], (x, y))).collect();
        let new: Vec<Vec<usize>> = ends.iter().map(|&u| self.samples(self.nodes[u], to)).collect();
        let d: f32 = ends.iter().zip(old.iter().zip(&new)).map(|(&u, (o, n))| self.moved_cost(self.nodes[u], (x, y), o, n)).sum();
        if d >= 0.0 {
            self.steps[v] = (step * 0.5).max(0.25);
            return false;
        }
        self.steps[v] = (step * 1.2).min(8.0);
        for &u in &ends {
            self.stamp(self.nodes[u], (x, y), -1.0);
            self.stamp(self.nodes[u], to, 1.0);
        }
        self.nodes[v] = to;
        true
    }

    // One proposal: a line flip (annealed) or a gradient step on a node. Returns whether the drawing changed.
    // Node steps stop with the cooling schedule: they always find some sliver of improvement, and the finish
    // is a pure descent on the lines that ends once a whole pass changes nothing.
    pub fn step(&mut self, rng: &mut impl Rng) -> bool {
        self.steps_taken += 1;
        let shifting = self.steps_taken < self.schedule && rng.gen::<f32>() < self.shift_rate;
        let changed = if shifting { self.shift(rng) } else { self.flip(rng) };
        self.temperature *= self.cooling;
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

#[cfg(test)]
mod tests {
    use super::*;

    // The analytic node gradient should match a finite difference of the loss change the optimizer checks.
    #[test]
    fn node_gradient_matches_finite_difference() {
        let (w, h) = (80, 80);
        let dark: Vec<f32> = (0..w * h).map(|i| { let (x, y) = ((i % w) as f32 - 40.0, (i / w) as f32 - 40.0); if x * x + y * y < 600.0 { 0.8 } else { 0.0 } }).collect();
        let p = Params { nodes: 30, sigma: 2.0, ink: 0.3, start_temperature: 0.0, sweeps: 1.0, paper: 4.0, detail: 0.0, gamma: 1.0, shift_rate: 0.0, features: 0.0 };
        let mut rng = rand::thread_rng();
        let mut g = GraphArt::new(dark, w, h, &p, &mut rng);
        for _ in 0..g.on.len() * 2 { g.step(&mut rng); }
        let (mut agree, mut total) = (0, 0);
        for v in 0..g.nodes.len() {
            let ends: Vec<usize> = (0..g.nodes.len()).filter(|&u| u != v && g.on[g.pair(u, v)]).collect();
            let (x, y) = g.nodes[v];
            if ends.is_empty() || x < 5.0 || y < 5.0 || x > 74.0 || y > 74.0 { continue; }
            let (gx, gy) = g.node_gradient(v, &ends);
            let gn = (gx * gx + gy * gy).sqrt();
            if gn < 1e-4 { continue; }
            let h = 1.5;
            let to = (x - gx / gn * h, y - gy / gn * h);
            let d: f32 = ends.iter().map(|&u| g.moved_cost(g.nodes[u], (x, y), &g.samples(g.nodes[u], (x, y)), &g.samples(g.nodes[u], to))).sum();
            total += 1;
            if d < 0.0 { agree += 1; }
        }
        assert!(total > 5 && agree * 10 >= total * 7, "{} of {} steps against the gradient lowered the loss", agree, total);
    }
}

// Abramowitz and Stegun 7.1.26, good to about 1e-7.
fn erf(x: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * x.abs());
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * (-x * x).exp();
    if x < 0.0 { -y } else { y }
}
