// Approximates a grayscale image with one unbroken line: a Hamiltonian path through a set of nodes, every
// segment the same width. The loss is graph_art's blurred loss, |sqrt(W) (G D - T)|^2 + lambda * ink, where D
// is the drawing, T the photo's darkness, G a Gaussian blur and W a per-pixel weight.
//
// Each iteration alternates the two halves of the problem:
// - simulated annealing on the order: a move reverses a stretch of the path (2-opt), which swaps the two lines
//   at its ends for two new ones. The move's exact change in loss comes from blurring just those four lines,
//   so it is cheap, and accepted moves update the blurred residual G D - T in place.
// - gradient descent on the nodes: one Adam step on every node position, with the gradient worked out as in
//   graph_art, learning rate warming up linearly and then following a cosine down to 0.
// The annealing temperature cools geometrically over the same iterations.
use crate::graph_art::{bilinear, blur, prepare, samples};
use rand::Rng;

pub struct PathArt {
    // the photo plus a margin all round; positions are in this frame
    width: usize,
    height: usize,
    margin: f32,
    // where nodes may go: x from .0 to .1, y from .2 to .3
    bounds: (f32, f32, f32, f32),
    nodes: Vec<(f32, f32)>,
    // the path visits nodes[order[0]], nodes[order[1]], ...; pos is its inverse
    pub order: Vec<u32>,
    pos: Vec<u32>,
    // G T, the blurred target
    target: Vec<f32>,
    weight: Vec<f32>,
    sigma: f32,
    kernel: Vec<f32>,
    // a 2D stroke kernel, (2 radius + 1) on a side, used instead of the Gaussian: the ridge, or a learned one
    stroke: Option<Vec<f32>>,
    // with a learned ridge, its radius, the peak Adam learning rate for its log, and that log's Adam moments
    learn_ridge: bool,
    pub ridge_radius: f32,
    lr_kernel: f32,
    m_r: f32,
    v_r: f32,
    // the splat window's area at the start
    splat_area: usize,
    lambda: f32,
    // ink per unit length of every segment, which is its width in pixels
    pub line: f32,
    // ink in the dot on every node
    dot: f32,
    // G D - T, kept up to date through accepted moves
    residual: Vec<f32>,
    // G of a proposed move's change to D, nonzero only at the pixels in `touched`
    scratch: Vec<f32>,
    touched: Vec<u32>,
    lr_node: f32,
    m_n: Vec<f32>,
    v_n: Vec<f32>,
    pub iterations: usize,
    warmup: usize,
    pub iteration: usize,
    pub loss: f32,
    temp_start: f32,
    temp_end: f32,
    // line samples blurred per iteration's annealing, which bounds its time whatever the lines' lengths
    budget: usize,
    pub accepted: usize,
    // T_c: the photo's darkness summed over each block, blurred
    coarse_target: Vec<f32>,
    airbrush: bool,
    // the darkness the drawing aims for, unblurred
    photo: Vec<f32>,
    coarse_weight: f32,
    coarse_block: f32,
    coarse_sigma: f32,
    coarse_until: f32,
}

pub struct Params {
    pub nodes: usize,
    pub sigma: f32,
    pub iterations: usize,
    pub line: f32,
    pub lr_node: f32,
    pub paper: f32,
    pub detail: f32,
    pub gamma: f32,
    pub features: f32,
    pub lambda: f32,
    pub warmup: usize,
    pub temp_start: f32,
    pub temp_end: f32,
    pub budget: usize,
    // starting weight of the coarse loss
    pub coarse: f32,
    // its grid's block size in pixels, and its blur in blocks
    pub coarse_block: f32,
    pub coarse_sigma: f32,
    // the fraction of the way through by which it has faded out
    pub coarse_until: f32,
    // how dark the drawing aims to be, as a fraction of the photo
    pub tone: f32,
    // ink in the dot drawn on each node (pi r^2 for a solid dot of radius r)
    pub dot: f32,
    // draw with a soft stroke, as wide as the loss's blur, instead of a sharp line
    pub airbrush: bool,
    // > 0: an airbrush stroke whose darkness falls off linearly to 0 at this many pixels from its centre,
    // instead of a Gaussian
    pub ridge: f32,
    // learn the ridge's radius along with the nodes, starting from `ridge`; lr_kernel is the peak Adam learning
    // rate for the log of the radius
    pub learn_ridge: bool,
    pub lr_kernel: f32,
}

const BETA1: f32 = 0.9;
const BETA2: f32 = 0.999;
// the range a learned ridge radius is kept to, in pixels
const RIDGE_MIN: f32 = 0.75;
const RIDGE_MAX: f32 = 10.0;
// The coarse grid's margin, in blocks, so that nodes at the image's edge still feel the coarse loss
const COARSE_PAD: f32 = 2.0;
// A line longer than this many sigmas counts as long
const LONG: f32 = 8.0;

// The 2D kernel whose blur of a straight line falls off linearly, from its centre to 0 at radius r: the inverse
// Abel transform of that profile, arccosh(r / d) / (pi r) at distance d, averaged over each pixel because it is
// infinite at the centre, and normalized. (2 n + 1) on a side, row-major.
fn ridge_kernel(r: f32, n: i32) -> Vec<f32> {
    const SUB: i32 = 16;
    let mut k = vec![];
    for y in -n..=n {
        for x in -n..=n {
            let mut a = 0.0;
            for sy in 0..SUB {
                for sx in 0..SUB {
                    let (px, py) = (x as f32 + (sx as f32 + 0.5) / SUB as f32 - 0.5, y as f32 + (sy as f32 + 0.5) / SUB as f32 - 0.5);
                    let d = (px * px + py * py).sqrt();
                    if d < r {
                        a += (r / d).acosh();
                    }
                }
            }
            k.push(a);
        }
    }
    let s: f32 = k.iter().sum();
    k.iter().map(|v| v / s).collect()
}

// Half the side of a ridge kernel of radius r: just enough, or one more when the radius is learned so the
// derivative sees the pixels it would grow into
fn ridge_size(r: f32, learned: bool) -> i32 {
    r.ceil() as i32 + learned as i32
}

// The coarse grid's size, margins included
fn coarse_size(width: usize, height: usize, block: f32) -> (usize, usize) {
    ((width as f32 / block).ceil() as usize + 2 * COARSE_PAD as usize + 1, (height as f32 / block).ceil() as usize + 2 * COARSE_PAD as usize + 1)
}

impl PathArt {
    // darkness: row-major, 0 = white, 1 = black
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, p: &Params, rng: &mut impl Rng) -> PathArt {
        // Work on the photo with a margin of paper around it, so that ink near the edge is all counted and blurred
        // like anywhere else; otherwise lines could hide ink by hugging the edge. Nodes stay on the photo.
        let margin = (3.0 * p.sigma).max(if p.learn_ridge { RIDGE_MAX } else { p.ridge }).ceil() as usize + 2;
        let (inner_w, inner_h) = (width, height);
        let (width, height) = (inner_w + 2 * margin, inner_h + 2 * margin);
        let mut padded = vec![0f32; width * height];
        for y in 0..inner_h {
            padded[(y + margin) * width + margin..(y + margin) * width + margin + inner_w].copy_from_slice(&darkness[y * inner_w..(y + 1) * inner_w]);
        }
        let m = margin as f32;
        let bounds = (m + 0.5, m + inner_w as f32 - 0.5, m + 0.5, m + inner_h as f32 - 0.5);
        // start from noise: nodes anywhere, visited in a random order
        let nodes: Vec<(f32, f32)> = (0..p.nodes)
            .map(|_| (bounds.0 + rng.gen::<f32>() * (bounds.1 - bounds.0), bounds.2 + rng.gen::<f32>() * (bounds.3 - bounds.2)))
            .collect();
        let n = nodes.len();
        let mut order: Vec<u32> = (0..n as u32).collect();
        for i in (1..n).rev() {
            order.swap(i, rng.gen_range(0..=i));
        }
        let mut pos = vec![0u32; n];
        for (i, &v) in order.iter().enumerate() {
            pos[v as usize] = i as u32;
        }
        let (target, weight, darkness) = prepare(&padded, width, height, p.detail, p.gamma, p.paper, p.features, p.sigma);
        // one line can only lay down so much ink, so it aims for a lighter version of the photo
        let photo: Vec<f32> = darkness.iter().map(|d| d * p.tone).collect();
        // With an airbrush stroke the drawing itself is blurred, a soft line with a Gaussian profile of width
        // sigma, so it is compared with the photo directly rather than with a blurred photo.
        let target: Vec<f32> = if p.airbrush { photo.clone() } else { target.iter().map(|t| t * p.tone).collect() };
        let f = p.coarse_block;
        let (cw, ch) = coarse_size(width, height, f);
        let mut blocks = vec![0f32; cw * ch];
        for y in 0..height {
            for x in 0..width {
                let (bx, by) = ((x as f32 / f + COARSE_PAD) as usize, (y as f32 / f + COARSE_PAD) as usize);
                blocks[by * cw + bx] += darkness[y * width + x];
            }
        }
        let total = blocks.iter().sum::<f32>().max(1e-6);
        let r = (p.sigma * 3.0).ceil() as i32;
        let k: Vec<f32> = (-r..=r).map(|i| (-(i * i) as f32 / (2.0 * p.sigma * p.sigma)).exp()).collect();
        let s: f32 = k.iter().sum();
        let mut g = PathArt {
            width,
            height,
            margin: m,
            bounds,
            nodes,
            order,
            pos,
            target,
            weight,
            sigma: p.sigma,
            kernel: k.iter().map(|v| v / s).collect(),
            stroke: if p.ridge > 0.0 { Some(ridge_kernel(p.ridge, ridge_size(p.ridge, p.learn_ridge))) } else { None },
            learn_ridge: p.learn_ridge,
            ridge_radius: p.ridge,
            lr_kernel: p.lr_kernel,
            m_r: 0.0,
            v_r: 0.0,
            splat_area: 1,
            lambda: p.lambda,
            line: p.line,
            dot: p.dot,
            residual: vec![],
            scratch: vec![0.0; width * height],
            touched: vec![],
            lr_node: p.lr_node,
            m_n: vec![0.0; 2 * n],
            v_n: vec![0.0; 2 * n],
            iterations: p.iterations,
            warmup: p.warmup,
            iteration: 0,
            loss: 0.0,
            temp_start: p.temp_start,
            temp_end: p.temp_end,
            budget: p.budget,
            accepted: 0,
            airbrush: p.airbrush,
            photo,
            coarse_target: blur(&blocks.iter().map(|b| b * n as f32 / total).collect::<Vec<_>>(), cw, ch, p.coarse_sigma),
            coarse_block: f,
            coarse_sigma: p.coarse_sigma,
            coarse_until: p.coarse_until,
            coarse_weight: p.coarse,
        };
        g.splat_area = (2 * g.radius() as usize + 2).pow(2);
        g.forward();
        g
    }

    // Node positions in the photo's pixels
    pub fn points(&self) -> Vec<(f32, f32)> {
        self.nodes.iter().map(|&(x, y)| (x - self.margin, y - self.margin)).collect()
    }

    // The drawing as it is shown, in the photo's pixels: the ink itself, blurred if it is airbrushed.
    pub fn shown(&self) -> Vec<f32> {
        let (d, _) = self.render();
        let d = if self.airbrush { self.conv(&d, false) } else { d };
        let m = self.margin as usize;
        let (w, h) = (self.width - 2 * m, self.height - 2 * m);
        (0..w * h).map(|i| d[(i / w + m) * self.width + i % w + m]).collect()
    }

    // Mean squared difference between the drawing as shown and the darkness it aims for, per photo pixel.
    pub fn pixel_error(&self) -> f32 {
        let m = self.margin as usize;
        let w = self.width - 2 * m;
        let shown = self.shown();
        shown.iter().enumerate().map(|(i, s)| (s - self.photo[(i / w + m) * self.width + i % w + m]).powi(2)).sum::<f32>() / shown.len() as f32
    }

    fn length(&self, a: u32, b: u32) -> f32 {
        let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
        ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt()
    }

    // Renders the path's ink, and the dots on its nodes. Returns it and the lines' total ink.
    fn render(&self) -> (Vec<f32>, f32) {
        let (w, h) = (self.width, self.height);
        let mut d = vec![0f32; w * h];
        let mut ink = 0.0;
        for s in self.order.windows(2) {
            let ((ax, ay), (bx, by)) = (self.nodes[s[0] as usize], self.nodes[s[1] as usize]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            let n = samples(len);
            let mass = self.line * len / n as f32;
            ink += self.line * len;
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
        for &(x, y) in &self.nodes {
            if let Some((j, fx, fy)) = bilinear(x, y, w, h) {
                d[j] += self.dot * (1.0 - fx) * (1.0 - fy);
                d[j + 1] += self.dot * fx * (1.0 - fy);
                d[j + w] += self.dot * (1.0 - fx) * fy;
                d[j + w + 1] += self.dot * fx * fy;
            }
        }
        (d, ink)
    }

    // Renders the path and sets the residual G D - T and the loss.
    fn forward(&mut self) {
        let (d, ink) = self.render();
        self.residual = self.conv(&d, false).iter().zip(&self.target).map(|(g, t)| g - t).collect();
        self.loss = self.lambda * ink + self.residual.iter().zip(&self.weight).map(|(r, wt)| wt * r * r).sum::<f32>();
    }

    // Gradient of the loss with respect to a learned ridge's radius, through every kernel entry; the kernel's
    // own derivative comes from a central difference, as it is only known as a pixel-averaged integral.
    fn radius_gradient(&self) -> f32 {
        let gk = self.kernel_gradient();
        let (r, n) = (self.ridge_radius, self.radius());
        let d = 0.02;
        let (up, down) = (ridge_kernel(r + d, n), ridge_kernel(r - d, n));
        gk.iter().zip(up.iter().zip(&down)).map(|(g, (u, l))| g * (u - l) / (2.0 * d)).sum()
    }

    // Sets a learned ridge's radius, with room in the kernel for it to grow a little.
    fn set_ridge(&mut self, r: f32) {
        self.ridge_radius = r;
        self.stroke = Some(ridge_kernel(r, ridge_size(r, true)));
    }

    // Gradient of the loss with respect to each entry of the 2D stroke kernel: 2 sum_p (W r)(p) D(p - u) for the
    // entry at offset u.
    fn kernel_gradient(&self) -> Vec<f32> {
        let (w, h) = (self.width as i32, self.height as i32);
        let r = self.radius();
        let n = 2 * r + 1;
        let (d, _) = self.render();
        let wr: Vec<f32> = self.residual.iter().zip(&self.weight).map(|(r, wt)| wt * r).collect();
        let mut g = vec![0f32; (n * n) as usize];
        // one entry at a time, as dot products of shifted rows, which vectorizes
        let wu = w as usize;
        for dy in -r..=r {
            for dx in -r..=r {
                let (x0, x1) = ((-dx).max(0) as usize, (w - dx).min(w) as usize);
                let mut a = 0.0;
                for y in (-dy).max(0) as usize..(h - dy).min(h) as usize {
                    let (yy, xx0) = ((y as i32 + dy) as usize, (x0 as i32 + dx) as usize);
                    let (p, q) = (&d[y * wu + x0..y * wu + x1], &wr[yy * wu + xx0..yy * wu + xx0 + (x1 - x0)]);
                    // eight running sums, so the sum need not be in order and can vectorize
                    let mut acc = [0f32; 8];
                    let (pc, qc) = (p.chunks_exact(8), q.chunks_exact(8));
                    let tail: f32 = pc.remainder().iter().zip(qc.remainder()).map(|(a, b)| a * b).sum();
                    for (pp, qq) in pc.zip(qc) {
                        for l in 0..8 {
                            acc[l] += pp[l] * qq[l];
                        }
                    }
                    a += acc.iter().sum::<f32>() + tail;
                }
                g[((dy + r) * n + dx + r) as usize] = 2.0 * a;
            }
        }
        g
    }

    // The coarse loss |G_c (N_c - T_c)|^2, where N_c counts the nodes in each coarse_block-pixel block and T_c is
    // the photo's darkness per block, scaled to the same number of nodes; and E_c = G_c G_c (N_c - T_c).
    fn coarse(&self) -> (f32, Vec<f32>) {
        let (w, h) = coarse_size(self.width, self.height, self.coarse_block);
        let mut d = vec![0f32; w * h];
        for &(x, y) in &self.nodes {
            if let Some((j, fx, fy)) = bilinear(x / self.coarse_block + COARSE_PAD, y / self.coarse_block + COARSE_PAD, w, h) {
                d[j] += (1.0 - fx) * (1.0 - fy);
                d[j + 1] += fx * (1.0 - fy);
                d[j + w] += (1.0 - fx) * fy;
                d[j + w + 1] += fx * fy;
            }
        }
        let r: Vec<f32> = blur(&d, w, h, self.coarse_sigma).iter().zip(&self.coarse_target).map(|(g, t)| g - t).collect();
        (r.iter().map(|r| r * r).sum(), blur(&r, w, h, self.coarse_sigma))
    }

    // How far the stroke's kernel reaches, in pixels
    fn radius(&self) -> i32 {
        match &self.stroke {
            Some(k) => ((k.len() as f32).sqrt() as i32 - 1) / 2,
            None => (self.kernel.len() / 2) as i32,
        }
    }

    // G applied to an image: the Gaussian blur, or the 2D stroke kernel (flipped for G's adjoint, which a
    // learned kernel needs since it need not be symmetric).
    fn conv(&self, src: &[f32], adjoint: bool) -> Vec<f32> {
        let (w, h) = (self.width, self.height);
        let k = match &self.stroke {
            Some(k) => k,
            None => return blur(src, w, h, self.sigma),
        };
        let r = self.radius();
        let n = 2 * r + 1;
        let mut out = vec![0f32; w * h];
        // one kernel weight at a time, as a shifted copy of whole rows, which vectorizes
        for dy in -r..=r {
            for dx in -r..=r {
                let (ky, kx) = if adjoint { (r - dy, r - dx) } else { (dy + r, dx + r) };
                let kv = k[(ky * n + kx) as usize];
                let (x0, x1) = ((-dx).max(0) as usize, (w as i32 - dx).min(w as i32) as usize);
                for y in (-dy).max(0) as usize..(h as i32 - dy).min(h as i32) as usize {
                    let (yy, xx0) = ((y as i32 + dy) as usize, (x0 as i32 + dx) as usize);
                    let from = &src[y * w + x0..y * w + x1];
                    for (o, v) in out[yy * w + xx0..yy * w + xx0 + (x1 - x0)].iter_mut().zip(from) {
                        *o += kv * v;
                    }
                }
            }
        }
        out
    }

    // Adds sign * G (the line a-b) into scratch. Returns how much work that took: samples, scaled by the
    // kernel's area against the one it started with, so a learned ridge that grows doesn't slow the annealing.
    fn splat(&mut self, a: u32, b: u32, sign: f32) -> usize {
        let (w, h) = (self.width, self.height);
        let ((ax, ay), (bx, by)) = (self.nodes[a as usize], self.nodes[b as usize]);
        let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
        let n = samples(len);
        let mass = sign * self.line * len / n as f32;
        let r = self.radius();
        let m = 2 * r as usize + 2;
        // the stroke of a bilinear splat: the kernel centred on each of its four pixels, mixed
        let (mut kx, mut ky) = (vec![0f32; m], vec![0f32; m]);
        let mut win = vec![0f32; m * m];
        for i in 0..n {
            let t = (i as f32 + 0.5) / n as f32;
            let (j, fx, fy) = match bilinear(ax + (bx - ax) * t, ay + (by - ay) * t, w, h) {
                Some(s) => s,
                None => continue,
            };
            let (x0, y0) = ((j % w) as i32, (j / w) as i32);
            if let Some(k) = &self.stroke {
                let n = m - 1;
                let at = |qx: usize, qy: usize| if qx < n && qy < n { k[qy * n + qx] } else { 0.0 };
                for qy in 0..m {
                    for qx in 0..m {
                        let (lx, ly) = (qx.wrapping_sub(1), qy.wrapping_sub(1));
                        win[qy * m + qx] = mass
                            * ((1.0 - fx) * (1.0 - fy) * at(qx, qy) + fx * (1.0 - fy) * at(lx, qy) + (1.0 - fx) * fy * at(qx, ly) + fx * fy * at(lx, ly));
                    }
                }
            } else {
                // a Gaussian is separable: in each axis, the kernel at x0 and at x0 + 1, mixed
                for q in 0..m {
                    let k0 = if q < m - 1 { self.kernel[q] } else { 0.0 };
                    let k1 = if q > 0 { self.kernel[q - 1] } else { 0.0 };
                    kx[q] = (1.0 - fx) * k0 + fx * k1;
                    ky[q] = mass * ((1.0 - fy) * k0 + fy * k1);
                }
                for qy in 0..m {
                    for qx in 0..m {
                        win[qy * m + qx] = ky[qy] * kx[qx];
                    }
                }
            }
            for qy in 0..m {
                let y = y0 - r + qy as i32;
                if y < 0 || y >= h as i32 {
                    continue;
                }
                for qx in 0..m {
                    let x = x0 - r + qx as i32;
                    if x < 0 || x >= w as i32 {
                        continue;
                    }
                    let p = y as usize * w + x as usize;
                    if self.scratch[p] == 0.0 {
                        self.touched.push(p as u32);
                    }
                    // never exactly 0 once touched, so a pixel is listed once
                    self.scratch[p] += win[qy * m + qx] + 1e-30;
                }
            }
        }
        n * m * m / self.splat_area
    }

    // E = G W (G D - T), half the loss's derivative with respect to D
    fn e(&self) -> Vec<f32> {
        self.conv(&self.residual.iter().zip(&self.weight).map(|(r, wt)| wt * r).collect::<Vec<_>>(), true)
    }

    // A few hundred to a few thousand 2-opt moves at temperature `temp`. A move picks a node a and a node c
    // near it, and reverses the stretch of path between them so that they become neighbours on it.
    fn anneal(&mut self, temp: f32, rng: &mut impl Rng) {
        let n = self.nodes.len();
        if n < 3 {
            return;
        }
        let grid = Grid::new(&self.nodes, self.width, self.height);
        let mut spent = 0;
        while spent < self.budget {
            let i = rng.gen_range(0..n);
            let a = self.order[i];
            let c = match grid.near(a, &self.nodes, rng) {
                Some(c) => c,
                None => continue,
            };
            let j = self.pos[c as usize] as usize;
            let (l, r) = if j > i { (i + 1, j) } else { (j, i - 1) };
            spent += 1;
            if l >= r {
                continue;
            }
            // the lines at the ends of the stretch, before and after the reversal
            let (o, last) = (&self.order, n - 1);
            let mut old = vec![];
            let mut new = vec![];
            if l > 0 {
                old.push((o[l - 1], o[l]));
                new.push((o[l - 1], o[r]));
            }
            if r < last {
                old.push((o[r], o[r + 1]));
                new.push((o[l], o[r + 1]));
            }
            let mut dlen = 0.0;
            for &(p, q) in &old {
                dlen -= self.length(p, q);
            }
            for &(p, q) in &new {
                dlen += self.length(p, q);
            }
            // Blurring four lines is slow when they are long, as they are while the path is still a tangle, so
            // then only moves that shorten the path are worth blurring.
            let longest = old.iter().chain(&new).map(|&(p, q)| self.length(p, q)).fold(0.0, f32::max);
            if dlen > 0.0 && longest > LONG * self.sigma {
                continue;
            }
            for &(p, q) in &old {
                spent += self.splat(p, q, -1.0);
            }
            for &(p, q) in &new {
                spent += self.splat(p, q, 1.0);
            }
            let mut delta = self.lambda * self.line * dlen;
            for &p in &self.touched {
                let (g, p) = (self.scratch[p as usize], p as usize);
                delta += self.weight[p] * g * (2.0 * self.residual[p] + g);
            }
            let accept = delta < 0.0 || rng.gen::<f32>() < (-delta / temp).exp();
            for &p in &self.touched {
                let p = p as usize;
                if accept {
                    self.residual[p] += self.scratch[p];
                }
                self.scratch[p] = 0.0;
            }
            self.touched.clear();
            if accept {
                self.loss += delta;
                self.accepted += 1;
                self.order[l..=r].reverse();
                for k in l..=r {
                    self.pos[self.order[k] as usize] = k as u32;
                }
            }
        }
    }

    // Adds the gradient of the loss, with respect to every node's (x, y), given E = G W (G D - T). Leaves out the
    // ink cost.
    fn backward(&self, e: &[f32], gn: &mut [f32]) {
        let (w, h) = (self.width, self.height);
        let wk = self.line;
        // moving a node moves its dot
        for (v, &(x, y)) in self.nodes.iter().enumerate() {
            if let Some((j, fx, fy)) = bilinear(x, y, w, h) {
                let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
                gn[2 * v] += 2.0 * self.dot * ((q - p) * (1.0 - fy) + (s - r) * fy);
                gn[2 * v + 1] += 2.0 * self.dot * ((r - p) * (1.0 - fx) + (s - q) * fx);
            }
        }
        for s in self.order.windows(2) {
            let (a, b) = (s[0] as usize, s[1] as usize);
            let ((ax, ay), (bx, by)) = (self.nodes[a], self.nodes[b]);
            let (dx, dy) = (bx - ax, by - ay);
            let len = (dx * dx + dy * dy).sqrt().max(1e-3);
            let n = samples(len);
            // sum of E, and of t * grad E and (1 - t) * grad E, along the line
            let (mut se, mut gbx, mut gby, mut gax, mut gay) = (0.0, 0.0, 0.0, 0.0, 0.0);
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                if let Some((j, fx, fy)) = bilinear(ax + dx * t, ay + dy * t, w, h) {
                    let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
                    se += p * (1.0 - fx) * (1.0 - fy) + q * fx * (1.0 - fy) + r * (1.0 - fx) * fy + s * fx * fy;
                    let ex = (q - p) * (1.0 - fy) + (s - r) * fy;
                    let ey = (r - p) * (1.0 - fx) + (s - q) * fx;
                    gbx += ex * t;
                    gby += ey * t;
                    gax += ex * (1.0 - t);
                    gay += ey * (1.0 - t);
                }
            }
            let mass = 2.0 * wk * len / n as f32;
            // stretching the line puts more ink at every sample
            let stretch = 2.0 * wk / n as f32 * se;
            let (ux, uy) = (dx / len, dy / len);
            gn[2 * b] += mass * gbx + stretch * ux;
            gn[2 * b + 1] += mass * gby + stretch * uy;
            gn[2 * a] += mass * gax - stretch * ux;
            gn[2 * a + 1] += mass * gay - stretch * uy;
        }
    }

    // The ink cost's gradient: a pull of lambda * line along every segment.
    fn tension(&self, gn: &mut [f32]) {
        for s in self.order.windows(2) {
            let (a, b) = (s[0] as usize, s[1] as usize);
            let ((ax, ay), (bx, by)) = (self.nodes[a], self.nodes[b]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt().max(1e-3);
            let (ux, uy) = (self.lambda * self.line * (bx - ax) / len, self.lambda * self.line * (by - ay) / len);
            gn[2 * b] += ux;
            gn[2 * b + 1] += uy;
            gn[2 * a] -= ux;
            gn[2 * a + 1] -= uy;
        }
    }

    // Gradient of the loss plus coarse times the coarse loss, with respect to every node's (x, y).
    fn gradient(&self, coarse: f32) -> Vec<f32> {
        let mut gn = vec![0f32; 2 * self.nodes.len()];
        self.backward(&self.e(), &mut gn);
        if coarse > 0.0 {
            let (_, e) = self.coarse();
            let (w, h) = coarse_size(self.width, self.height, self.coarse_block);
            let k = 2.0 * coarse / self.coarse_block;
            for (v, &(x, y)) in self.nodes.iter().enumerate() {
                if let Some((j, fx, fy)) = bilinear(x / self.coarse_block + COARSE_PAD, y / self.coarse_block + COARSE_PAD, w, h) {
                    let (p, q, r, s) = (e[j], e[j + 1], e[j + w], e[j + w + 1]);
                    gn[2 * v] += k * ((q - p) * (1.0 - fy) + (s - r) * fy);
                    gn[2 * v + 1] += k * ((r - p) * (1.0 - fx) + (s - q) * fx);
                }
            }
        }
        self.tension(&mut gn);
        gn
    }

    // One round of annealing on the order, then one Adam step on the nodes. Returns false once the schedule
    // is over.
    pub fn step(&mut self, rng: &mut impl Rng) -> bool {
        if self.iteration >= self.iterations {
            return false;
        }
        let progress = self.iteration as f32 / (self.iterations - 1).max(1) as f32;
        let temp = self.temp_start * (self.temp_end / self.temp_start).powf(progress);
        self.anneal(temp, rng);
        // the coarse loss spreads the nodes out like the photo's darkness, pulling them in from across the paper
        // early on, and fades out by coarse_until of the way through
        let coarse = self.coarse_weight * (1.0 - progress / self.coarse_until).max(0.0).powi(2);
        let gn = self.gradient(coarse);
        let gr = if self.learn_ridge { Some(self.radius_gradient()) } else { None };
        self.iteration += 1;
        let t = self.iteration as f32;
        // linear warmup to the peak learning rate, then a cosine down to 0 at the last step
        let schedule = if self.iteration <= self.warmup {
            t / self.warmup as f32
        } else {
            let progress = (self.iteration - self.warmup) as f32 / (self.iterations - self.warmup).max(1) as f32;
            0.5 * (1.0 + (std::f32::consts::PI * progress).cos())
        };
        let (c1, c2) = (1.0 - BETA1.powf(t), 1.0 - BETA2.powf(t));
        let lr = self.lr_node * schedule;
        let (x0, x1, y0, y1) = self.bounds;
        for v in 0..self.nodes.len() {
            let mut u = [0.0; 2];
            for c in 0..2 {
                let k = 2 * v + c;
                self.m_n[k] = BETA1 * self.m_n[k] + (1.0 - BETA1) * gn[k];
                self.v_n[k] = BETA2 * self.v_n[k] + (1.0 - BETA2) * gn[k] * gn[k];
                u[c] = (self.m_n[k] / c1) / ((self.v_n[k] / c2).sqrt() + 1e-8);
            }
            let (x, y) = self.nodes[v];
            self.nodes[v] = ((x - lr * u[0]).clamp(x0, x1), (y - lr * u[1]).clamp(y0, y1));
        }
        if let Some(gr) = gr {
            // Adam on the log of the radius, on the same schedule as the nodes
            let g = gr * self.ridge_radius;
            self.m_r = BETA1 * self.m_r + (1.0 - BETA1) * g;
            self.v_r = BETA2 * self.v_r + (1.0 - BETA2) * g * g;
            let step = self.lr_kernel * schedule * (self.m_r / c1) / ((self.v_r / c2).sqrt() + 1e-8);
            self.set_ridge((self.ridge_radius.ln() - step).exp().clamp(RIDGE_MIN, RIDGE_MAX));
        }
        self.forward();
        true
    }
}

// Buckets nodes into square cells about two nodes' spacing wide, to find a node's neighbours.
struct Grid {
    cell: f32,
    cols: usize,
    rows: usize,
    // nodes sorted by cell, and where each cell's run starts
    start: Vec<u32>,
    items: Vec<u32>,
}

impl Grid {
    fn new(nodes: &[(f32, f32)], width: usize, height: usize) -> Grid {
        let cell = (2.0 * (width * height) as f32 / nodes.len() as f32).sqrt().max(1.0);
        let (cols, rows) = ((width as f32 / cell).ceil() as usize + 1, (height as f32 / cell).ceil() as usize + 1);
        let at = |&(x, y): &(f32, f32)| (y / cell) as usize * cols + (x / cell) as usize;
        let mut start = vec![0u32; cols * rows + 1];
        for p in nodes {
            start[at(p) + 1] += 1;
        }
        for i in 0..cols * rows {
            start[i + 1] += start[i];
        }
        let mut fill = start.clone();
        let mut items = vec![0u32; nodes.len()];
        for (v, p) in nodes.iter().enumerate() {
            let c = at(p);
            items[fill[c] as usize] = v as u32;
            fill[c] += 1;
        }
        Grid { cell, cols, rows, start, items }
    }

    // A random other node in the 3x3 block of cells around a's.
    fn near(&self, a: u32, nodes: &[(f32, f32)], rng: &mut impl Rng) -> Option<u32> {
        let (x, y) = nodes[a as usize];
        let (cx, cy) = ((x / self.cell) as i32, (y / self.cell) as i32);
        let mut runs = [(0u32, 0u32); 9];
        let mut total = 0;
        for (k, (dx, dy)) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (0, 0), (1, 0), (-1, 1), (0, 1), (1, 1)].iter().enumerate() {
            let (x, y) = (cx + dx, cy + dy);
            if x >= 0 && y >= 0 && (x as usize) < self.cols && (y as usize) < self.rows {
                let c = y as usize * self.cols + x as usize;
                runs[k] = (self.start[c], self.start[c + 1]);
                total += self.start[c + 1] - self.start[c];
            }
        }
        if total < 2 {
            return None;
        }
        let mut pick = rng.gen_range(0..total);
        for &(s, e) in &runs {
            if pick < e - s {
                let c = self.items[(s + pick) as usize];
                return if c == a { None } else { Some(c) };
            }
            pick -= e - s;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc() -> Vec<f32> {
        (0..60 * 60).map(|i| { let (x, y) = ((i % 60) as f32 - 30.0, (i / 60) as f32 - 30.0); if x * x + y * y < 300.0 { 0.8 } else { 0.0 } }).collect()
    }

    fn params() -> Params {
        Params { nodes: 40, sigma: 2.0, iterations: 30, line: 0.8, lr_node: 0.5, paper: 4.0, detail: 0.0, gamma: 1.0, features: 0.0, lambda: 0.02, warmup: 3, temp_start: 1.0, temp_end: 0.01, budget: 2000, coarse: 0.3, coarse_block: 6.0, coarse_sigma: 2.0, coarse_until: 0.5, tone: 1.0, dot: 3.0, airbrush: false, ridge: 0.0, learn_ridge: false, lr_kernel: 0.0 }
    }

    // the same, as a ridge-shaped airbrush stroke
    fn ridge() -> Params {
        Params { airbrush: true, ridge: 2.5, ..params() }
    }

    // the same, with a learned radius
    fn learned(rng: &mut impl Rng) -> PathArt {
        PathArt::new(disc(), 60, 60, &Params { learn_ridge: true, lr_kernel: 0.05, ..ridge() }, rng)
    }

    // The loss the annealing keeps track of move by move should match a fresh render.
    #[test]
    fn annealing_tracks_the_loss() {
        let mut rng = rand::thread_rng();
        tracks(PathArt::new(disc(), 60, 60, &params(), &mut rng));
        tracks(PathArt::new(disc(), 60, 60, &ridge(), &mut rng));
        tracks(learned(&mut rng));
    }

    // The kernel's and the learned radius's gradients should match finite differences of the loss.
    #[test]
    fn kernel_gradients_match_finite_differences() {
        let mut rng = rand::thread_rng();
        let mut g = learned(&mut rng);
        for _ in 0..10 { g.step(&mut rng); }
        let gk = g.kernel_gradient();
        // the loss is quadratic in the kernel, so a central difference is exact at any step
        let eps = 0.05;
        for i in 0..gk.len() {
            let k0 = g.stroke.as_ref().unwrap()[i];
            g.stroke.as_mut().unwrap()[i] = k0 + eps; g.forward(); let up = g.loss;
            g.stroke.as_mut().unwrap()[i] = k0 - eps; g.forward(); let down = g.loss;
            g.stroke.as_mut().unwrap()[i] = k0;
            let fd = (up - down) / (2.0 * eps);
            assert!((fd - gk[i]).abs() <= 0.02 * fd.abs().max(gk[i].abs()) + 0.05, "entry {}: analytic {} vs numeric {}", i, gk[i], fd);
        }
        let gr = g.radius_gradient();
        let (r, n) = (g.ridge_radius, g.radius());
        let at = |g: &mut PathArt, r: f32| { g.stroke = Some(ridge_kernel(r, n)); g.forward(); g.loss };
        let fd = (at(&mut g, r + 0.02) - at(&mut g, r - 0.02)) / 0.04;
        assert!((fd - gr).abs() <= 0.05 * fd.abs().max(gr.abs()) + 0.05, "radius: analytic {} vs numeric {}", gr, fd);
    }

    fn tracks(mut g: PathArt) {
        let mut rng = rand::thread_rng();
        g.anneal(1.0, &mut rng);
        assert!(g.accepted > 0);
        let (tracked, residual) = (g.loss, g.residual.clone());
        g.forward();
        assert!((tracked - g.loss).abs() <= 1e-3 * g.loss.abs() + 1e-2, "tracked {} vs fresh {}", tracked, g.loss);
        let worst = residual.iter().zip(&g.residual).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(worst < 1e-3, "residual off by {}", worst);
    }

    // The analytic node gradients should match finite differences of the loss.
    #[test]
    fn gradients_match_finite_differences() {
        let mut rng = rand::thread_rng();
        gradients(PathArt::new(disc(), 60, 60, &params(), &mut rng), 30);
        gradients(PathArt::new(disc(), 60, 60, &ridge(), &mut rng), 30);
        gradients(learned(&mut rng), 30);
    }

    fn gradients(mut g: PathArt, steps: usize) {
        let mut rng = rand::thread_rng();
        for _ in 0..steps { g.step(&mut rng); }
        // check the fine and coarse losses together
        let mu = 0.3;
        let gn = g.gradient(mu);
        let total = |g: &mut PathArt| { g.forward(); g.loss + mu * g.coarse().0 };
        let eps = 1e-2;
        let (mut checked, mut missed) = (0, 0);
        for v in 0..g.nodes.len() {
            let (x, y) = g.nodes[v];
            // a node held at the edge sits on a pixel centre, where bilinear interpolation has a kink
            let (x0, x1, y0, y1) = g.bounds;
            if x <= x0 + eps || x >= x1 - eps || y <= y0 + eps || y >= y1 - eps { continue; }
            // so does a dot crossing a row or column of pixel centres
            let kink = |c: f32| ((c - 0.5) - (c - 0.5).round()).abs() < 2.0 * eps;
            if kink(x) || kink(y) { continue; }
            // a line's sample count steps when its length crosses a whole number; skip nodes with a line near one
            let i = g.pos[v] as usize;
            let near_step = [i.wrapping_sub(1), i + 1].iter().filter(|&&k| k < g.order.len()).any(|&k| {
                let len = g.length(v as u32, g.order[k]);
                (len - len.round()).abs() < 2.0 * eps
            });
            if near_step { continue; }
            for c in 0..2 {
                let at = |d: f32| if c == 0 { (x + d, y) } else { (x, y + d) };
                let mid = total(&mut g);
                g.nodes[v] = at(eps); let up = total(&mut g);
                g.nodes[v] = at(-eps); let down = total(&mut g);
                g.nodes[v] = (x, y);
                let fd = (up - down) / (2.0 * eps);
                let an = gn[2 * v + c];
                if fd.abs() < 5e-2 { continue; }
                // the loss is only piecewise smooth (bilinear sampling has kinks at pixel centres, which matter
                // with a peaked kernel), so the gradient may match the slope on one side instead
                let near = |fd: f32| (fd - an).abs() <= 0.25 * fd.abs().max(an.abs()) + 2e-2;
                if !(near(fd) || near((up - mid) / eps) || near((mid - down) / eps)) {
                    eprintln!("node {} axis {}: analytic {} vs numeric {}", v, c, an, fd);
                    missed += 1;
                }
                checked += 1;
            }
        }
        assert!(checked > 5);
        // several kinks inside one finite difference can still throw off the odd node
        assert!(missed * 10 <= checked, "{} of {} gradients off", missed, checked);
    }
}
