mod utils;
pub mod graph_art;

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
            lr_width: 0.1,
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
            min_width: 1e-6,
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
