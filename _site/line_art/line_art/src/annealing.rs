use rand::Rng;
use web_sys::js_sys::Math::exp;
use wasm_bindgen::prelude::*;

pub trait RandomWalk {
    fn step(&mut self, rng: &mut impl Rng);
    fn step_back(&mut self);
    fn score(&self) -> f32;
}

pub struct Annealer {
    pub temperature: f32,
    pub cooling_rate: f32,
}

impl Annealer {
    pub fn new(temperature: f32, cooling_rate: f32) -> Annealer {
        Annealer {
            temperature,
            cooling_rate,
        }
    }
    pub fn anneal<T: RandomWalk>(&mut self, walk: &mut T, rng: &mut rand::rngs::ThreadRng) {
        let score = walk.score();
        walk.step(rng);
        let new_score = walk.score();
        let delta = new_score - score;

        let p = delta / self.temperature;

        if new_score < score && (exp(p as f64) as f32) < rng.gen::<f32>() {
            walk.step_back();
        }
        self.temperature *= 1.0 - self.cooling_rate;
    }

    pub fn anneal_n<T: RandomWalk>(&mut self, walk: &mut T, rng: &mut rand::rngs::ThreadRng, n: usize) {
        for _ in 0..n {
            self.anneal(walk, rng);
        }
    }
}