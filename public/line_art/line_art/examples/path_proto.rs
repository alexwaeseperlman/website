// Native harness for tuning the path version: runs it on a raw f32 darkness image and writes nodes and order.
// path_proto <darkness.f32> <width> <height> <out.txt> [key=value ...] with keys from path_art::Params.
use line_art::path_art::{Params, PathArt};
use std::io::Write;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let bytes = std::fs::read(&a[1]).unwrap();
    let dark: Vec<f32> = bytes.chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let mut p = Params { nodes: 1500, sigma: 2.0, iterations: 1000, line: 1.0, lr_node: 1.0, paper: 12.0, detail: 3.0, gamma: 2.0, features: 6.0, lambda: 0.02, warmup: 50, temp_start: 5.0, temp_end: 0.01, budget: 60000, coarse: 1.0, coarse_block: 10.0, coarse_sigma: 3.0, coarse_until: 0.5, tone: 1.0, dot: 4.5 };
    let mut snap = vec![];
    for kv in &a[5..] {
        let (k, v) = kv.split_once('=').unwrap();
        let v: f32 = v.parse().unwrap();
        match k {
            "nodes" => p.nodes = v as usize,
            "sigma" => p.sigma = v,
            "iterations" => p.iterations = v as usize,
            "line" => p.line = v,
            "lr_node" => p.lr_node = v,
            "paper" => p.paper = v,
            "detail" => p.detail = v,
            "gamma" => p.gamma = v,
            "features" => p.features = v,
            "lambda" => p.lambda = v,
            "warmup" => p.warmup = v as usize,
            "temp_start" => p.temp_start = v,
            "temp_end" => p.temp_end = v,
            "budget" => p.budget = v as usize,
            "coarse" => p.coarse = v,
            "tone" => p.tone = v,
            "coarse_until" => p.coarse_until = v,
            "dot" => p.dot = v,
            "coarse_block" => p.coarse_block = v,
            "coarse_sigma" => p.coarse_sigma = v,
            "snap" => snap.push(v as usize),
            _ => panic!("unknown key {}", k),
        }
    }
    let mut rng = rand::thread_rng();
    let t = std::time::Instant::now();
    let mut g = PathArt::new(dark, w, h, &p, &mut rng);
    let first = g.loss;
    let mut f = std::fs::File::create(&a[4]).unwrap();
    let mut write = |g: &PathArt| {
        writeln!(f, "{}", g.points().iter().map(|(x, y)| format!("{} {}", x, y)).collect::<Vec<_>>().join(",")).unwrap();
        writeln!(f, "{}", g.order.iter().map(|o| o.to_string()).collect::<Vec<_>>().join(",")).unwrap();
    };
    let mut last = 0;
    while g.step(&mut rng) {
        if snap.contains(&g.iteration) { write(&g); }
        if g.iteration % 100 == 0 {
            eprintln!("{} loss {:.0} accepted {} ({:?})", g.iteration, g.loss, g.accepted - last, t.elapsed());
            last = g.accepted;
        }
    }
    write(&g);
    eprintln!("{} iterations, loss {:.0} -> {:.0}, {:?}", g.iterations, first, g.loss, t.elapsed());
}
