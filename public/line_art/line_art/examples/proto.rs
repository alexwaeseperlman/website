use line_art::graph_art::{GraphArt, Params};
use std::io::Write;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (w, h): (usize, usize) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    let bytes = std::fs::read(&a[1]).unwrap();
    let dark: Vec<f32> = bytes.chunks(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let p = Params { nodes: a[4].parse().unwrap(), sigma: a[5].parse().unwrap(), ink: a[6].parse().unwrap(), start_temperature: a[7].parse().unwrap(), sweeps: a[8].parse().unwrap(), paper: a[10].parse().unwrap(), detail: a[11].parse().unwrap(), shift_rate: a[12].parse().unwrap(), gamma: a[13].parse().unwrap() };
    let mut rng = rand::thread_rng();
    let t = std::time::Instant::now();
    let mut g = GraphArt::new(dark, w, h, &p, &mut rng);
    let total = (g.on.len() as f32 * (p.sweeps + 3.0)) as usize;
    let mut acc = 0;
    for _ in 0..total { if g.step(&mut rng) { acc += 1; } }
    let e = g.edges();
    eprintln!("{} proposals, {} accepted, {} edges, {:?}", total, acc, e.len(), t.elapsed());
    let mut f = std::fs::File::create(&a[9]).unwrap();
    writeln!(f, "{}", g.nodes.iter().map(|(x, y)| format!("{x} {y}")).collect::<Vec<_>>().join(",")).unwrap();
    writeln!(f, "{}", e.iter().map(|(a, b)| format!("{a} {b}")).collect::<Vec<_>>().join(",")).unwrap();
}
