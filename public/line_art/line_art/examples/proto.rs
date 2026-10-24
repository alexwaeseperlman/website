// Native harness for tuning: runs the optimizer on a raw f32 darkness image and writes nodes and lines.
// proto <darkness.f32> <width> <height> <out.txt> [key=value ...] with keys from Params.
use line_art::graph_art::{GraphArt, Params};
use std::io::Write;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let bytes = std::fs::read(&a[1]).unwrap();
    let dark: Vec<f32> = bytes.chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let mut p = Params { nodes: 300, sigma: 2.0, iterations: 1000, lr_width: 0.02, lr_node: 1.0, paper: 12.0, detail: 3.0, gamma: 2.0, features: 6.0, lambda: 0.02, max_width: 1.5, warmup: 50, start_lines: 3000, start_width: 0.3, dot: 4.52 };
    for kv in &a[5..] {
        let (k, v) = kv.split_once('=').unwrap();
        let v: f32 = v.parse().unwrap();
        match k {
            "nodes" => p.nodes = v as usize,
            "sigma" => p.sigma = v,
            "iterations" => p.iterations = v as usize,
            "lr_width" => p.lr_width = v,
            "lr_node" => p.lr_node = v,
            "paper" => p.paper = v,
            "detail" => p.detail = v,
            "gamma" => p.gamma = v,
            "features" => p.features = v,
            "lambda" => p.lambda = v,
            "max_width" => p.max_width = v,
            "warmup" => p.warmup = v as usize,
            "start_lines" => p.start_lines = v as usize,
            "start_width" => p.start_width = v,
            "dot" => p.dot = v,
            _ => panic!("unknown key {}", k),
        }
    }
    let mut rng = rand::thread_rng();
    let t = std::time::Instant::now();
    let mut g = GraphArt::new(dark, w, h, &p, &mut rng);
    let mut first = None;
    while g.step() {
        first.get_or_insert(g.loss);
    }
    let e = g.edges();
    eprintln!("{} iterations, loss {:.0} -> {:.0}, {} lines, {:?}", g.iterations, first.unwrap_or(0.0), g.loss, e.len(), t.elapsed());
    let mut f = std::fs::File::create(&a[4]).unwrap();
    writeln!(f, "{}", g.nodes.iter().map(|(x, y)| format!("{} {}", x, y)).collect::<Vec<_>>().join(",")).unwrap();
    writeln!(f, "{}", e.iter().map(|(a, b, w)| format!("{} {} {}", a, b, w)).collect::<Vec<_>>().join(",")).unwrap();
}
