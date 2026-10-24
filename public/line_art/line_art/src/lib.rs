mod utils;
pub mod graph_art;

use graph_art::{GraphArt, Params};
use utils::set_panic_hook;
use wasm_bindgen::prelude::*;

// The worker (../../wasm-worker.js) owns the timing: it calls run() in short bursts and posts the graph back.
#[wasm_bindgen]
pub struct Face {
    graph: GraphArt,
    rng: rand::rngs::ThreadRng,
}

#[wasm_bindgen]
impl Face {
    // darkness: row-major, 0 = white, 1 = black
    #[wasm_bindgen(constructor)]
    pub fn new(darkness: Vec<f32>, width: usize, height: usize, nodes: usize, sigma: f32, ink: f32) -> Face {
        set_panic_hook();
        let mut rng = rand::thread_rng();
        let params = Params { nodes, sigma, ink, start_temperature: 1.0, sweeps: 10.0, paper: 12.0, detail: 3.0, shift_rate: 0.015, gamma: 2.0, features: 6.0 };
        Face { graph: GraphArt::new(darkness, width, height, &params, &mut rng), rng }
    }

    // Runs `proposals` flips; returns how many were accepted.
    pub fn run(&mut self, proposals: u32) -> u32 {
        (0..proposals).filter(|_| self.graph.step(&mut self.rng)).count() as u32
    }

    // Proposals in one pass over every pair of nodes. A pass with nothing accepted after cooling means it's done.
    pub fn sweep(&self) -> u32 {
        self.graph.on.len() as u32
    }

    // Proposals in the whole cooling schedule.
    pub fn schedule(&self) -> u32 {
        self.graph.schedule as u32
    }

    // [x0, y0, x1, y1, ...]
    pub fn nodes(&self) -> Vec<f32> {
        self.graph.nodes.iter().flat_map(|&(x, y)| [x, y]).collect()
    }

    // [a0, b0, a1, b1, ...] node indices of the lines that are drawn
    pub fn edges(&self) -> Vec<u16> {
        self.graph.edges().iter().flat_map(|&(a, b)| [a, b]).collect()
    }
}
