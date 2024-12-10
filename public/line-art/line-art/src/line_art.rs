use rand::seq::SliceRandom;

use crate::annealing::*;

const MAX_CNT: i32 = 50;

#[derive(Clone, Copy)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}


pub struct LineArt {
    points: Vec<Point>,
    lines: Vec<Vec<i32>>,

    line_permutation: Vec<(usize, usize)>,
    cur_step: usize,

    pub image: Vec<Vec<f32>>,
    target_image: Vec<Vec<f32>>,

    score: f32,

    last_changed: Option<(usize, usize, i32)>,
}

fn loss(a: f32, b: f32) -> f32 {
    (a.clamp(-1.5f32, 1f32) - b).abs()
}

fn color_contribution(color: i32) -> f32 {
    return -color as f32 / MAX_CNT as f32;
}

impl LineArt {
    pub fn new(point_cnt: usize, target_image: Vec<Vec<f32>>, rng: &mut impl rand::Rng) -> LineArt {
        let mut points = Vec::new();
        let mut lines = Vec::new();
        let width = target_image[0].len();
        let height = target_image.len();
        for _ in 0..point_cnt {
            points.push(Point {
                x: (rng.gen::<f32>() * width as f32),
                y: (rng.gen::<f32>() * height as f32),
            });
            lines.push(vec![0; point_cnt as usize]);
        }

        let mut image = vec![vec![1f32; width]; height];
        let mut score = 0f32;
        for i in 0..target_image.len() {
            for j in 0..target_image[0].len() {
                score += loss(image[i][j], target_image[i][j]);
            }
        }
        let mut out = LineArt {
            points,
            lines,
            image,
            target_image,
            score,
            last_changed: None,
            line_permutation: (0..point_cnt).flat_map(|i| (i..point_cnt).map(move |j| (i, j))).collect(),
            cur_step: 0,
        };
        out.shuffle_lines(rng);
        out
    }

    fn shuffle_lines(&mut self, rng: &mut impl rand::Rng) {
        self.line_permutation.shuffle(rng);
    }

    fn step_line(&mut self, i1: usize, i2: usize, direction: i32) {
        let (mut p1, mut p2) = (self.points[i1], self.points[i2]);
        if p1.x > p2.x {
            std::mem::swap(&mut p1, &mut p2);
        }
        let m = (1f32 + p2.y - p1.y) / (1f32 + p2.x - p1.x);

        for x in (p1.x.floor() as i32)..=(p2.x.ceil() as i32) {
            let mut y1 = (m * (x as f32 - p1.x) + p1.y);
            let mut y2 = (m * (x as f32 + 1f32 - p1.x) + p1.y);

            if y1 > y2 {
                std::mem::swap(&mut y1, &mut y2);
            }
            
            let y1i = y1.floor() as i32;
            let y2i = y2.ceil() as i32;

            for y in  y1i..y2i {
                if x >= 0 && x < self.image.len() as i32 && y >= 0 && y < self.image[0].len() as i32 {
                    self.score -= loss(self.image[x as usize][y as usize], self.target_image[x as usize][y as usize]);
                    self.image[x as usize][y as usize] -= color_contribution(self.lines[i1][i2]);
                    self.image[x as usize][y as usize] += color_contribution(self.lines[i1][i2] + direction);
                    self.score += loss(self.image[x as usize][y as usize], self.target_image[x as usize][y as usize]);
                }
            }
        }
        self.lines[i1][i2] += direction;
        self.lines[i2][i1] += direction;
    }
}

impl RandomWalk for LineArt {
    fn score(&self) -> f32 {
        -self.score
    }
    fn step(&mut self, rng: &mut impl rand::Rng) {
        //let i1 = rng.gen_range(0..self.points.len());
        //let i2 = rng.gen_range(0..self.points.len());

        let (i1, i2) = self.line_permutation[self.cur_step];
        self.cur_step += 1;

        if self.cur_step >= self.line_permutation.len() {
            self.cur_step = 0;
            self.shuffle_lines(rng);
        }

        let direction = match self.lines[i1][i2] {
            0 => 1,
            MAX_CNT => -1,
            _ => rng.gen_range(0..=1)*2 - 1,
        };

        self.step_line(i1, i2, direction);
        self.last_changed = Some((i1, i2, direction));
    }

    fn step_back(&mut self) {
        if let Some((i1, i2, direction)) = self.last_changed {
            self.step_line(i1, i2, -direction);
            self.last_changed = None;
        }
    }
}