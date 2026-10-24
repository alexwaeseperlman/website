// Approximates a grayscale image with a graph: a set of nodes, and between every pair a straight line whose
// width (ink per unit length, 0 = no line) is a free parameter. The loss compares the drawing to the photo
// after blurring both with a Gaussian, so thin lines can stand in for shading instead of having to hit single
// pixels, plus a small cost per unit of ink so lines that barely help go to zero.
//
// With D the ink of the drawing, T the darkness of the photo, G the blur and W a per-pixel weight, the loss is
// |sqrt(W) G (D - T)|^2 + lambda * ink. Each iteration renders D, blurs, and gets E = G W G (D - T), which is
// half the loss's derivative with respect to D. Every gradient follows from it: a line's width by summing E
// along the line, a node's position by summing the gradient of E along each of its lines. All line widths
// and node positions then take one Adam step, with the learning rate on a cosine schedule from its peak to 0,
// and widths are clamped to [0, max_width].
use rand::Rng;

pub struct GraphArt {
    width: usize,
    height: usize,
    pub nodes: Vec<(f32, f32)>,
    pairs: Vec<(u16, u16)>,
    pub widths: Vec<f32>,
    // G T, the blurred target
    target: Vec<f32>,
    weight: Vec<f32>,
    sigma: f32,
    lambda: f32,
    max_width: f32,
    lr_width: f32,
    lr_node: f32,
    // Adam moments for the widths, then for the node coordinates
    m_w: Vec<f32>,
    v_w: Vec<f32>,
    m_n: Vec<f32>,
    v_n: Vec<f32>,
    pub iterations: usize,
    pub iteration: usize,
    pub loss: f32,
}

pub struct Params {
    pub nodes: usize,
    pub sigma: f32,
    pub iterations: usize,
    // peak Adam learning rates: width units per step, and pixels per step
    pub lr_width: f32,
    pub lr_node: f32,
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
}

const BETA1: f32 = 0.9;
const BETA2: f32 = 0.999;

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

// Bilinear weights of a point in pixel space, where pixel i covers [i, i + 1): its four pixels' indices and
// weights, or None when it falls outside the image.
fn bilinear(x: f32, y: f32, w: usize, h: usize) -> Option<(usize, f32, f32)> {
    let (x, y) = (x - 0.5, y - 0.5);
    if x < 0.0 || y < 0.0 || x >= (w - 1) as f32 || y >= (h - 1) as f32 {
        return None;
    }
    let (x0, y0) = (x as usize, y as usize);
    Some((y0 * w + x0, x - x0 as f32, y - y0 as f32))
}

// Points along a segment, one per unit of length (at least one), at fractions t = (i + 0.5) / n.
fn samples(len: f32) -> usize {
    len.ceil().max(1.0) as usize
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
        GraphArt {
            width,
            height,
            nodes,
            pairs,
            widths: vec![0.0; k],
            target: blur(&darkness, width, height, p.sigma),
            weight,
            sigma: p.sigma,
            lambda: p.lambda,
            max_width: p.max_width,
            lr_width: p.lr_width,
            lr_node: p.lr_node,
            m_w: vec![0.0; k],
            v_w: vec![0.0; k],
            m_n: vec![0.0; 2 * n],
            v_n: vec![0.0; 2 * n],
            iterations: p.iterations,
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
            if wk <= 0.0 {
                continue;
            }
            let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            let n = samples(len);
            let mass = wk * len / n as f32;
            ink += wk * len;
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                if let Some((j, fx, fy)) = bilinear(ax + (bx - ax) * t, ay + (by - ay) * t, w, h) {
                    d[j] += mass * (1.0 - fx) * (1.0 - fy);
                    d[j + 1] += mass * fx * (1.0 - fy);
                    d[j + w] += mass * (1.0 - fx) * fy;
                    d[j + w + 1] += mass * fx * fy;
                }
            }
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
    // Lines with no ink only need to know whether adding some would help, so unless `all` is set they are
    // skipped, and when they are checked it is at every other pixel; E is blurred twice, so smooth at that
    // scale. They are most of the pairs, so this is most of the time saved.
    fn backward(&self, e: &[f32], all: bool) -> (Vec<Option<f32>>, Vec<f32>) {
        let (w, h) = (self.width, self.height);
        let mut gw = vec![None; self.pairs.len()];
        let mut gn = vec![0f32; 2 * self.nodes.len()];
        for (k, &(a, b)) in self.pairs.iter().enumerate() {
            let wk = self.widths[k];
            if wk <= 0.0 && !all {
                continue;
            }
            let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
            let (dx, dy) = (bx - ax, by - ay);
            let len = (dx * dx + dy * dy).sqrt().max(1e-3);
            let n = if wk > 0.0 { samples(len) } else { samples(len / 2.0) };
            // sum of E, and of t * grad E and (1 - t) * grad E, along the line
            let (mut se, mut gbx, mut gby, mut gax, mut gay) = (0.0, 0.0, 0.0, 0.0, 0.0);
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                if let Some((j, fx, fy)) = bilinear(ax + dx * t, ay + dy * t, w, h) {
                    let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
                    se += p * (1.0 - fx) * (1.0 - fy) + q * fx * (1.0 - fy) + r * (1.0 - fx) * fy + s * fx * fy;
                    if wk > 0.0 {
                        let ex = (q - p) * (1.0 - fy) + (s - r) * fy;
                        let ey = (r - p) * (1.0 - fx) + (s - q) * fx;
                        gbx += ex * t;
                        gby += ey * t;
                        gax += ex * (1.0 - t);
                        gay += ey * (1.0 - t);
                    }
                }
            }
            // each sample carries wk * len / n of ink
            let per = len / n as f32;
            gw[k] = Some(2.0 * per * se + self.lambda * len);
            if wk > 0.0 {
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
        let (gw, gn) = self.backward(&e, self.iteration % 8 == 0);
        self.iteration += 1;
        let t = self.iteration as f32;
        let cosine = 0.5 * (1.0 + (std::f32::consts::PI * (t - 1.0) / self.iterations as f32).cos());
        let (c1, c2) = (1.0 - BETA1.powf(t), 1.0 - BETA2.powf(t));
        let adam = |g: f32, m: &mut f32, v: &mut f32| {
            *m = BETA1 * *m + (1.0 - BETA1) * g;
            *v = BETA2 * *v + (1.0 - BETA2) * g * g;
            (*m / c1) / ((*v / c2).sqrt() + 1e-8)
        };
        let lr = self.lr_width * cosine;
        for k in 0..self.widths.len() {
            // a skipped line keeps its moments and width until it is next checked (lazy Adam)
            let g = match gw[k] {
                Some(g) => g,
                None => continue,
            };
            let u = adam(g, &mut self.m_w[k], &mut self.v_w[k]);
            self.widths[k] = (self.widths[k] - lr * u).clamp(0.0, self.max_width);
        }
        let lr = self.lr_node * cosine;
        let (xmax, ymax) = (self.width as f32 - 0.5, self.height as f32 - 0.5);
        for v in 0..self.nodes.len() {
            let ux = adam(gn[2 * v], &mut self.m_n[2 * v], &mut self.v_n[2 * v]);
            let uy = adam(gn[2 * v + 1], &mut self.m_n[2 * v + 1], &mut self.v_n[2 * v + 1]);
            let (x, y) = self.nodes[v];
            self.nodes[v] = ((x - lr * ux).clamp(0.5, xmax), (y - lr * uy).clamp(0.5, ymax));
        }
        true
    }

    // Lines worth drawing, with their widths.
    pub fn edges(&self) -> Vec<(u16, u16, f32)> {
        self.pairs.iter().zip(&self.widths).filter(|(_, &w)| w > 0.01).map(|(&(a, b), &w)| (a, b, w)).collect()
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

    // The analytic gradients should match finite differences of the loss.
    #[test]
    fn gradients_match_finite_differences() {
        let (w, h) = (60, 60);
        let dark: Vec<f32> = (0..w * h).map(|i| { let (x, y) = ((i % w) as f32 - 30.0, (i / w) as f32 - 30.0); if x * x + y * y < 300.0 { 0.8 } else { 0.0 } }).collect();
        let p = Params { nodes: 12, sigma: 2.0, iterations: 30, lr_width: 0.05, lr_node: 0.5, paper: 4.0, detail: 0.0, gamma: 1.0, features: 0.0, lambda: 0.02, max_width: 1.5 };
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
                g.widths[k] > 0.0 && (len - len.round()).abs() < 2.0 * eps
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
