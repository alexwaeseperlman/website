mod utils;
pub mod graph_art;
pub mod path_art;

use graph_art::{GraphArt, Params};
use utils::set_panic_hook;
use wasm_bindgen::prelude::*;

// The worker (../../wasm-worker.js) calls step() once per frame and posts the graph back.
#[wasm_bindgen]
pub struct Face {
    graph: GraphArt,
}

#[wasm_bindgen]
impl Face {
    // darkness: row-major, 0 = white, 1 = black
    #[wasm_bindgen(constructor)]
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, nodes: usize, iterations: usize) -> Face {
        set_panic_hook();
        let mut rng = rand::thread_rng();
        let params = Params {
            nodes,
            sigma: 2.0,
            iterations,
            lr_width: 0.02,
            lr_node: 1.0,
            paper: 12.0,
            detail: 3.0,
            gamma: 2.0,
            features: 6.0,
            lambda: 0.02,
            max_width: 1.5,
            warmup: 50,
            start_lines: 3000,
            start_width: 0.3,
            dot: 4.52,
        };
        Face { graph: GraphArt::new(darkness, width, height, &params, &mut rng) }
    }

    // One Adam step on every line width and node position; false once the schedule is over.
    pub fn step(&mut self) -> bool {
        self.graph.step()
    }

    pub fn iteration(&self) -> usize {
        self.graph.iteration
    }

    pub fn loss(&self) -> f32 {
        self.graph.loss
    }

    // [x0, y0, x1, y1, ...]
    pub fn nodes(&self) -> Vec<f32> {
        self.graph.nodes.iter().flat_map(|&(x, y)| [x, y]).collect()
    }

    // [a0, b0, a1, b1, ...] node indices of the lines that are drawn
    pub fn edges(&self) -> Vec<u16> {
        self.graph.edges().iter().flat_map(|&(a, b, _)| [a, b]).collect()
    }

    // Width (ink per unit length) of each line in edges(), in the same order
    pub fn widths(&self) -> Vec<f32> {
        self.graph.edges().iter().map(|&(_, _, w)| w).collect()
    }
}

// The same, drawn as one unbroken line: a path through every node, all its segments the same width.
#[wasm_bindgen]
pub struct PathFace {
    path: path_art::PathArt,
    rng: rand::rngs::StdRng,
}

#[wasm_bindgen]
impl PathFace {
    // darkness: row-major, 0 = white, 1 = black
    #[wasm_bindgen(constructor)]
    // airbrush: a soft stroke instead of a sharp line, with a Gaussian profile, or with ridge > 0 one that falls
    // off linearly to 0 at ridge pixels from its centre; learn_ridge learns that radius along with the nodes,
    // starting from ridge; graphite draws like a pencil, as sharp streaks with no stroke kernel
    #[allow(clippy::too_many_arguments)]
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, nodes: usize, iterations: usize, airbrush: bool, ridge: f32, learn_ridge: bool, graphite: bool) -> PathFace {
        use rand::SeedableRng;
        set_panic_hook();
        let mut rng = rand::rngs::StdRng::from_entropy();
        let params = path_art::Params {
            nodes,
            sigma: 2.0,
            iterations,
            // a pencil presses lightly, so its strokes stay soft and build up tone by layering
            line: if graphite { PENCIL_LINE } else { 0.7 },
            lr_node: 12.0,
            paper: 12.0,
            detail: 3.0,
            gamma: 2.0,
            features: 6.0,
            lambda: 0.02,
            // the pencil's settings were hill-climbed on its own loss, mean over seeds
            warmup: if graphite { 25 } else { 50 },
            temp_start: 5.0,
            temp_end: 0.01,
            budget: 20000,
            coarse: if graphite { 4200.0 } else { 8400.0 },
            coarse_block: 10.0,
            coarse_sigma: if graphite { 10.0 } else { 5.0 },
            coarse_until: if graphite { 0.43 } else { 0.6 },
            tone: TONE,
            dot: if graphite { PENCIL_DOT } else { DOT_RADIUS * DOT_RADIUS * std::f32::consts::PI },
            airbrush,
            ridge,
            learn_ridge,
            lr_kernel: 0.05,
            pencil: false,
            graphite,
            fade: if graphite { 3.0 } else { 0.0 },
            fade_until: 0.85,
        };
        let path = path_art::PathArt::new(darkness, width, height, &params, &mut rng);
        PathFace { path, rng }
    }

    // A round of annealing on the path's order, then one Adam step on the nodes; false once the schedule is over.
    pub fn step(&mut self) -> bool {
        self.path.step(&mut self.rng)
    }

    // A step in parts, to show its annealing as it goes: one call per part, the last finishing the step; false
    // once the schedule is over
    pub fn step_part(&mut self, parts: usize) -> bool {
        self.path.step_part(&mut self.rng, parts)
    }

    // Once the path has converged, starts a second pass of `iterations` steps that draws it with a 3 px ridge
    // stroke and learns the ridge's radius while it keeps refining the nodes and the order. With pencil it learns
    // the stroke's whole profile instead, starting from that ridge.
    pub fn blur_pass(&mut self, iterations: usize, pencil: bool) {
        if pencil {
            self.path.lr_kernel = 0.15;
        }
        self.path.blur_pass(iterations, 3.0, pencil, 8.0, 2.0, 20);
    }

    // A pencil stroke's cross-section: its darkness, as shown, across a line at each whole pixel from its centre
    pub fn profile(&self) -> Vec<f32> {
        self.path.pencil_profile().iter().map(|v| v * self.path.line / TONE).collect()
    }

    pub fn iteration(&self) -> usize {
        self.path.iteration
    }

    pub fn loss(&self) -> f32 {
        self.path.loss
    }

    // [x0, y0, x1, y1, ...]
    pub fn nodes(&self) -> Vec<f32> {
        self.path.points().iter().flat_map(|&(x, y)| [x, y]).collect()
    }

    // [a0, b0, a1, b1, ...] node indices of the path's segments, in order
    pub fn edges(&self) -> Vec<u16> {
        self.path.order.windows(2).flat_map(|s| [s[0] as u16, s[1] as u16]).collect()
    }

    // Width (ink per unit length) of each segment in edges()
    pub fn widths(&self) -> Vec<f32> {
        vec![self.path.line; self.path.order.len().saturating_sub(1)]
    }

    // The drawing as the optimizer sees it, row-major in the photo's pixels, as darkness relative to the photo's
    // (1 = as dark as the darkest part of the photo it aims for). Only meaningful drawn as is for an airbrush.
    pub fn shown(&self) -> Vec<f32> {
        self.path.shown().iter().map(|v| v / TONE).collect()
    }

    // A pencil drawing as shown, like shown(), but rendered scale times finer, (photo width * scale) wide
    pub fn shown_fine(&self, scale: usize) -> Vec<f32> {
        self.path.shown_fine(scale).iter().map(|v| v / TONE).collect()
    }

    // The seed of a pencil's streaks, for pencil_image
    pub fn seed(&self) -> u64 {
        self.path.seed()
    }

    // The ridge's radius in pixels (0 for a sharp line or a Gaussian)
    pub fn ridge(&self) -> f32 {
        self.path.ridge_radius
    }

    // Radius of the solid dot on each node, whose ink the optimizer counts
    pub fn dot(&self) -> f32 {
        DOT_RADIUS
    }
}

const DOT_RADIUS: f32 = 0.6;
// how dark the path aims to be, as a fraction of the photo
const TONE: f32 = 0.6;
// a pencil line's ink per unit length, and its dots' ink
const PENCIL_LINE: f32 = 0.3;
const PENCIL_DOT: f32 = 0.4;

// A pencil drawing as RGBA pixels, (width * scale) by (height * scale), for nodes ([x0, y0, ...] in the photo's
// pixels) joined by edges ([a, b, ...]) as a PathFace with this seed draws them; grey, white where there is no
// graphite. It needs no PathFace, so the page can draw while the worker optimizes.
#[wasm_bindgen]
pub fn pencil_image(nodes: Vec<f32>, edges: Vec<u16>, seed: u64, width: usize, height: usize, scale: usize) -> Vec<u8> {
    let points: Vec<(f32, f32)> = nodes.chunks(2).map(|p| (p[0], p[1])).collect();
    let edges: Vec<(u32, u32)> = edges.chunks(2).map(|e| (e[0] as u32, e[1] as u32)).collect();
    let shown = path_art::pencil_render(&points, &edges, seed, PENCIL_LINE, PENCIL_DOT, width, height, scale);
    let mut out = vec![255u8; shown.len() * 4];
    for (o, v) in out.chunks_exact_mut(4).zip(&shown) {
        let g = (255.0 * (1.0 - (v / TONE).clamp(0.0, 1.0))) as u8;
        o[0] = g;
        o[1] = g;
        o[2] = g;
    }
    out
}
