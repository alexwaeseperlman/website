// Approximates a grayscale image with a graph: a set of nodes, and between every pair a straight line whose
// width (ink per unit length, 0 = no line) is a free parameter. The loss compares the drawing to the photo
// after blurring both with a Gaussian, so thin lines can stand in for shading instead of having to hit single
// pixels, plus a small cost per unit of ink so lines that barely help go to zero.
//
// With D the ink of the drawing (the lines, plus a fixed dot on every node), T the darkness of the photo, G the blur and W a per-pixel weight, the loss is
// |sqrt(W) G (D - T)|^2 + lambda * ink. Each iteration renders D, blurs, and gets E = G W G (D - T), which is
// half the loss's derivative with respect to D. Every gradient follows from it: a line's width by summing E
// along the line, a node's position by summing the gradient of E along each of its lines and at its dot. All line widths
// and node positions then take one Adam step, with the learning rate warming up linearly to its peak and then
// following a cosine down to 0, and widths are clamped to [0, max_width].
use rand::Rng;

pub struct GraphArt {
    width: usize,
    height: usize,
    pub nodes: Vec<(f32, f32)>,
    pairs: Vec<(u16, u16)>,
    pub widths: Vec<f32>,
    // the parameters Adam actually fits: widths = exp(log_widths), so no line is ever exactly 0
    log_widths: Vec<f32>,
    // G T, the blurred target
    target: Vec<f32>,
    weight: Vec<f32>,
    sigma: f32,
    dot: f32,
    lambda: f32,
    max_width: f32,
    min_width: f32,
    lr_width: f32,
    lr_node: f32,
    beta1: f32,
    beta2: f32,
    // Adam moments for the widths, then for the node coordinates
    m_w: Vec<f32>,
    v_w: Vec<f32>,
    m_n: Vec<f32>,
    v_n: Vec<f32>,
    pub iterations: usize,
    warmup: usize,
    pub iteration: usize,
    pub loss: f32,
}

pub struct Params {
    pub nodes: usize,
    pub sigma: f32,
    pub iterations: usize,
    // peak Adam learning rates: log width per step, and pixels per step
    pub lr_width: f32,
    pub lr_node: f32,
    // Adam's decay rates for the running mean and variance of the gradient
    pub beta1: f32,
    pub beta2: f32,
    // how much harder ink on white paper is penalized than ink on the subject
    pub paper: f32,
    // unsharp-mask strength that brings out eyes, nose and mouth against the much darker hair
    pub detail: f32,
    // > 1 lightens skin and other midtones so lines avoid crossing the face
    pub gamma: f32,
    // extra loss weight on detailed areas
    pub features: f32,
    // cost per unit of ink: higher means fewer, bolder lines
    pub lambda: f32,
    pub max_width: f32,
    // widths never go below this, so every line keeps a little pull on its nodes
    pub min_width: f32,
    // steps of linear learning-rate warmup before the cosine decay
    pub warmup: usize,
    // the random start: how many lines, with widths up to start_width
    pub start_lines: usize,
    pub start_width: f32,
    // ink in the dot drawn on each node (pi r^2 for a solid dot of radius r)
    pub dot: f32,
}

// Lines fainter than this are left out of the drawing the loss sees (all of them together hold a tiny amount
// of ink) and are not sent to be drawn (at under 1/255 opacity even on a 3x screen, they would not change a
// pixel), and their gradients are only checked every 16th step, with samples twice as far apart (lazy Adam).
const FAINT: f32 = 1e-3;

pub(crate) fn blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    let r = (sigma * 3.0).ceil() as usize;
    let k: Vec<f32> = (0..=2 * r).map(|i| (-((i as f32 - r as f32).powi(2)) / (2.0 * sigma * sigma)).exp()).collect();
    let s: f32 = k.iter().sum();
    let k: Vec<f32> = k.iter().map(|v| v / s).collect();
    // rows: each output pixel gathers its 2r + 1 neighbours, with the taps that fall off the edge dropped
    let mut tmp = vec![0f32; w * h];
    for (row, out) in src.chunks_exact(w).zip(tmp.chunks_exact_mut(w)) {
        for x in 0..w {
            let (lo, hi) = (x.saturating_sub(r), (x + r).min(w - 1));
            let taps = &k[lo + r - x..=hi + r - x];
            out[x] = row[lo..=hi].iter().zip(taps).map(|(a, b)| a * b).sum();
        }
    }
    // columns: each output row is a weighted sum of whole input rows, which runs along memory
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        let dst = &mut out[y * w..(y + 1) * w];
        for yy in y.saturating_sub(r)..=(y + r).min(h - 1) {
            let kv = k[yy + r - y];
            for (d, &t) in dst.iter_mut().zip(&tmp[yy * w..(yy + 1) * w]) {
                *d += kv * t;
            }
        }
    }
    out
}

// Bilinear weights of a point in pixel space, where pixel i covers [i, i + 1): its top-left pixel's index and
// the weights toward the next column and row. Nodes are kept inside [0.5, size - 0.5], so every point on a line
// is too; the clamp only matters on the last row and column.
#[inline(always)]
fn bilinear(x: f32, y: f32, w: usize, h: usize) -> (usize, f32, f32) {
    let (x, y) = ((x - 0.5).max(0.0), (y - 0.5).max(0.0));
    let (x0, y0) = ((x as usize).min(w - 2), (y as usize).min(h - 2));
    (y0 * w + x0, x - x0 as f32, y - y0 as f32)
}

// Points along a segment, one per SPACING pixels (at least one), at fractions t = (i + 0.5) / n. The drawing
// is blurred with sigma 2 before it is compared, which smooths samples 2 px apart into a continuous line
// (the ripple left is about e^-20 of the line's ink).
const SPACING: f32 = 2.0;
fn samples(len: f32) -> usize {
    (len / SPACING).ceil().max(1.0) as usize
}

impl GraphArt {
    // darkness: row-major, 0 = white, 1 = black
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, p: &Params, rng: &mut impl Rng) -> GraphArt {
        let wide = blur(&darkness, width, height, 8.0);
        let fine: Vec<f32> = darkness.iter().zip(&wide).map(|(d, w)| d - w).collect();
        let darkness: Vec<f32> = darkness.iter().zip(&fine).map(|(d, f)| (d + p.detail * f).clamp(0.0, 1.0).powf(p.gamma)).collect();
        let detail = blur(&fine.iter().map(|f| f.abs()).collect::<Vec<_>>(), width, height, 3.0);
        let dm = detail.iter().cloned().fold(1e-6f32, f32::max);
        // start from noise: nodes anywhere, and a random handful of lines with random widths
        let nodes: Vec<(f32, f32)> =
            (0..p.nodes).map(|_| (0.5 + rng.gen::<f32>() * (width - 1) as f32, 0.5 + rng.gen::<f32>() * (height - 1) as f32)).collect();
        // W is large on paper, so lines across the background cost more, and larger again where the photo has
        // detail (eyes, brows, nose, mouth), which is what reads as a likeness
        let light = blur(&darkness, width, height, 3.0);
        let weight: Vec<f32> = light.iter().zip(&detail).map(|(t, d)| 1.0 + p.paper * (1.0 - t).powi(4) + p.features * d / dm).collect();
        let n = nodes.len();
        let mut pairs = Vec::with_capacity(n * (n - 1) / 2);
        for i in 0..n {
            for j in i + 1..n {
                pairs.push((i as u16, j as u16));
            }
        }
        let k = pairs.len();
        // most lines start invisibly faint, a random few start visible; log-uniform either way
        let (floor, faint) = (p.min_width.ln(), (p.min_width * 100.0).ln());
        let mut log_widths: Vec<f32> = (0..k).map(|_| floor + rng.gen::<f32>() * (faint - floor)).collect();
        let (lo, hi) = ((0.01f32).ln(), p.start_width.ln());
        for _ in 0..p.start_lines {
            log_widths[rng.gen_range(0..k)] = lo + rng.gen::<f32>() * (hi - lo);
        }
        let widths = log_widths.iter().map(|u| u.exp()).collect();
        GraphArt {
            width,
            height,
            nodes,
            pairs,
            widths,
            log_widths,
            target: blur(&darkness, width, height, p.sigma),
            weight,
            sigma: p.sigma,
            dot: p.dot,
            lambda: p.lambda,
            max_width: p.max_width,
            min_width: p.min_width,
            lr_width: p.lr_width,
            lr_node: p.lr_node,
            beta1: p.beta1,
            beta2: p.beta2,
            m_w: vec![0.0; k],
            v_w: vec![0.0; k],
            m_n: vec![0.0; 2 * n],
            v_n: vec![0.0; 2 * n],
            iterations: p.iterations,
            warmup: p.warmup,
            iteration: 0,
            loss: 0.0,
        }
    }

    // Renders the drawing, and returns the loss and E = G W G (D - T).
    fn forward(&self) -> (f32, Vec<f32>) {
        let (w, h) = (self.width, self.height);
        let mut d = vec![0f32; w * h];
        let mut ink = 0.0;
        for (k, &(a, b)) in self.pairs.iter().enumerate() {
            let wk = self.widths[k];
            if wk < FAINT {
                continue;
            }
            let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            let n = samples(len);
            let mass = wk * len / n as f32;
            ink += wk * len;
            let (sx, sy) = ((bx - ax) / n as f32, (by - ay) / n as f32);
            for i in 0..n {
                let t = i as f32 + 0.5;
                let (j, fx, fy) = bilinear(ax + sx * t, ay + sy * t, w, h);
                d[j] += mass * (1.0 - fx) * (1.0 - fy);
                d[j + 1] += mass * fx * (1.0 - fy);
                d[j + w] += mass * (1.0 - fx) * fy;
                d[j + w + 1] += mass * fx * fy;
            }
        }
        // the dots on the nodes are part of the drawing too
        for &(x, y) in &self.nodes {
            let (j, fx, fy) = bilinear(x, y, w, h);
            d[j] += self.dot * (1.0 - fx) * (1.0 - fy);
            d[j + 1] += self.dot * fx * (1.0 - fy);
            d[j + w] += self.dot * (1.0 - fx) * fy;
            d[j + w + 1] += self.dot * fx * fy;
        }
        let gd = blur(&d, w, h, self.sigma);
        let mut loss = self.lambda * ink;
        let r: Vec<f32> = gd
            .iter()
            .zip(&self.target)
            .zip(&self.weight)
            .map(|((g, t), wt)| {
                let r = g - t;
                loss += wt * r * r;
                wt * r
            })
            .collect();
        (loss, blur(&r, w, h, self.sigma))
    }

    // Gradients of the loss: one per line width (None for a line skipped this time), and (x, y) per node.
    // Faint lines only need to know whether adding some would help, so unless `all` is set they are
    // skipped, and when they are checked it is with samples twice as far apart; E is blurred twice, so smooth at that
    // scale. They are most of the pairs, so this is most of the time saved.
    fn backward(&self, e: &[f32], all: bool) -> (Vec<Option<f32>>, Vec<f32>) {
        let (w, h) = (self.width, self.height);
        let mut gw = vec![None; self.pairs.len()];
        let mut gn = vec![0f32; 2 * self.nodes.len()];
        // moving a node moves its dot
        for (v, &(x, y)) in self.nodes.iter().enumerate() {
            let (j, fx, fy) = bilinear(x, y, w, h);
            let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
            gn[2 * v] += 2.0 * self.dot * ((q - p) * (1.0 - fy) + (s - r) * fy);
            gn[2 * v + 1] += 2.0 * self.dot * ((r - p) * (1.0 - fx) + (s - q) * fx);
        }
        for (k, &(a, b)) in self.pairs.iter().enumerate() {
            let wk = self.widths[k];
            let live = wk >= FAINT;
            if !live && !all {
                continue;
            }
            let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
            let (dx, dy) = (bx - ax, by - ay);
            let len = (dx * dx + dy * dy).sqrt().max(1e-3);
            let n = if live { samples(len) } else { samples(len / 2.0) };
            // sum of E, of grad E, and of t * grad E along the line; (1 - t) * grad E is the difference
            let (mut se, mut ex_sum, mut ey_sum, mut gbx, mut gby) = (0.0, 0.0, 0.0, 0.0, 0.0);
            let inv = 1.0 / n as f32;
            for i in 0..n {
                let t = (i as f32 + 0.5) * inv;
                let (j, fx, fy) = bilinear(ax + dx * t, ay + dy * t, w, h);
                let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
                let top = p + (q - p) * fx;
                let bottom = r + (s - r) * fx;
                se += top + (bottom - top) * fy;
                let ex = (q - p) + ((s - r) - (q - p)) * fy;
                let ey = bottom - top;
                ex_sum += ex;
                ey_sum += ey;
                gbx += ex * t;
                gby += ey * t;
            }
            let (gax, gay) = (ex_sum - gbx, ey_sum - gby);
            // each sample carries wk * len / n of ink
            let per = len / n as f32;
            gw[k] = Some(2.0 * per * se + self.lambda * len);
            let mass = wk * per;
            // stretching the line: more ink at every sample, and more ink cost
            let stretch = 2.0 * wk / n as f32 * se + self.lambda * wk;
            let (ux, uy) = (dx / len, dy / len);
            let (a, b) = (a as usize, b as usize);
            gn[2 * b] += 2.0 * mass * gbx + stretch * ux;
            gn[2 * b + 1] += 2.0 * mass * gby + stretch * uy;
            gn[2 * a] += 2.0 * mass * gax - stretch * ux;
            gn[2 * a + 1] += 2.0 * mass * gay - stretch * uy;
        }
        (gw, gn)
    }

    // One Adam step on every width and node position. Returns false once the schedule is over.
    pub fn step(&mut self) -> bool {
        if self.iteration >= self.iterations {
            return false;
        }
        let (loss, e) = self.forward();
        self.loss = loss;
        let (gw, gn) = self.backward(&e, self.iteration % 16 == 0);
        self.iteration += 1;
        let t = self.iteration as f32;
        // linear warmup to the peak learning rate, then a cosine down to 0 at the last step
        let schedule = if self.iteration <= self.warmup {
            t / self.warmup as f32
        } else {
            let progress = (self.iteration - self.warmup) as f32 / (self.iterations - self.warmup).max(1) as f32;
            0.5 * (1.0 + (std::f32::consts::PI * progress).cos())
        };
        let (b1, b2) = (self.beta1, self.beta2);
        let (c1, c2) = (1.0 - b1.powf(t), 1.0 - b2.powf(t));
        let adam = |g: f32, m: &mut f32, v: &mut f32| {
            *m = b1 * *m + (1.0 - b1) * g;
            *v = b2 * *v + (1.0 - b2) * g * g;
            (*m / c1) / ((*v / c2).sqrt() + 1e-20)
        };
        let lr = self.lr_width * schedule;
        let (floor, ceil) = (self.min_width.ln(), self.max_width.ln());
        for k in 0..self.widths.len() {
            // a skipped line keeps its moments and width until it is next checked (lazy Adam)
            let g = match gw[k] {
                Some(g) => g,
                None => continue,
            };
            // d loss / d log w = w * d loss / d w
            let u = adam(self.widths[k] * g, &mut self.m_w[k], &mut self.v_w[k]);
            self.log_widths[k] = (self.log_widths[k] - lr * u).clamp(floor, ceil);
            self.widths[k] = self.log_widths[k].exp();
        }
        let lr = self.lr_node * schedule;
        let (xmax, ymax) = (self.width as f32 - 0.5, self.height as f32 - 0.5);
        for v in 0..self.nodes.len() {
            let ux = adam(gn[2 * v], &mut self.m_n[2 * v], &mut self.v_n[2 * v]);
            let uy = adam(gn[2 * v + 1], &mut self.m_n[2 * v + 1], &mut self.v_n[2 * v + 1]);
            let (x, y) = self.nodes[v];
            self.nodes[v] = ((x - lr * ux).clamp(0.5, xmax), (y - lr * uy).clamp(0.5, ymax));
        }
        true
    }

    // Every line that is not too faint to see, with its width.
    pub fn edges(&self) -> Vec<(u16, u16, f32)> {
        self.pairs.iter().zip(&self.widths).filter(|(_, &w)| w >= FAINT).map(|(&(a, b), &w)| (a, b, w)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The analytic gradients should match finite differences of the loss.
    #[test]
    fn gradients_match_finite_differences() {
        let (w, h) = (60, 60);
        let dark: Vec<f32> = (0..w * h).map(|i| { let (x, y) = ((i % w) as f32 - 30.0, (i / w) as f32 - 30.0); if x * x + y * y < 300.0 { 0.8 } else { 0.0 } }).collect();
        let p = Params { nodes: 12, sigma: 2.0, iterations: 30, lr_width: 0.2, lr_node: 0.5, beta1: 0.9, beta2: 0.999, paper: 4.0, detail: 0.0, gamma: 1.0, features: 0.0, lambda: 0.02, max_width: 1.5, warmup: 3, start_lines: 30, start_width: 0.5, dot: 4.5, min_width: 1e-6 };
        let mut rng = rand::thread_rng();
        let mut g = GraphArt::new(dark, w, h, &p, &mut rng);
        for _ in 0..30 { g.step(); }
        let (_, e) = g.forward();
        let (gw, gn) = g.backward(&e, true);
        let gw: Vec<f32> = gw.into_iter().map(|g| g.unwrap()).collect();
        let eps = 1e-2;
        let mut checked = 0;
        for k in 0..g.widths.len() {
            if g.widths[k] < 0.05 { continue; }
            let w0 = g.widths[k];
            g.widths[k] = w0 + eps; let up = g.forward().0;
            g.widths[k] = w0 - eps; let down = g.forward().0;
            g.widths[k] = w0;
            let fd = (up - down) / (2.0 * eps);
            assert!((fd - gw[k]).abs() <= 0.05 * fd.abs().max(gw[k].abs()) + 1e-2, "width {}: analytic {} vs numeric {}", k, gw[k], fd);
            checked += 1;
        }
        for v in 0..g.nodes.len() {
            let (x, y) = g.nodes[v];
            if x < 3.0 || y < 3.0 || x > 57.0 || y > 57.0 { continue; }
            // a line's sample count steps when its length crosses a whole number, which the finite difference
            // would see as a jump; skip nodes with a line near one
            let near_step = (0..g.nodes.len()).filter(|&u| u != v).any(|u| {
                let (a, b) = (u.min(v), u.max(v));
                let k = g.pairs.iter().position(|&p| p == (a as u16, b as u16)).unwrap();
                let (ux, uy) = g.nodes[u];
                let len = ((x - ux).powi(2) + (y - uy).powi(2)).sqrt();
                g.widths[k] >= FAINT && (len / SPACING - (len / SPACING).round()).abs() < 2.0 * eps
            });
            if near_step { continue; }
            for c in 0..2 {
                let at = |d: f32| if c == 0 { (x + d, y) } else { (x, y + d) };
                g.nodes[v] = at(eps); let up = g.forward().0;
                g.nodes[v] = at(-eps); let down = g.forward().0;
                g.nodes[v] = (x, y);
                let fd = (up - down) / (2.0 * eps);
                let an = gn[2 * v + c];
                if fd.abs() < 5e-2 { continue; }
                assert!((fd - an).abs() <= 0.25 * fd.abs().max(an.abs()) + 2e-2, "node {} axis {}: analytic {} vs numeric {}", v, c, an, fd);
                checked += 1;
            }
        }
        assert!(checked > 5);
    }
}
