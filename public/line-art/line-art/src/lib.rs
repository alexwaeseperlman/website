mod utils;
mod annealing;
mod line_art;
use std::{array, rc::Rc, sync::{Arc, Mutex}};

use annealing::{Annealer, RandomWalk};
use line_art::LineArt;
use utils::set_panic_hook;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::console_log;
use web_sys::{js_sys::{self, Array, ArrayBuffer}, DedicatedWorkerGlobalScope};


#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}
const ITER_INTERVAL: i32 = 50;
const ITERS: i32 = 50;

use once_cell::sync::Lazy;

static line_art_arc: Lazy<Arc<Mutex<Option<LineArt>>>> = Lazy::new(|| {
    Arc::new(Mutex::new(None))
});

static annealer_arc: Lazy<Arc<Mutex<Option<Annealer>>>> = Lazy::new(|| {
    Arc::new(Mutex::new(None))
});

fn push_image(image: &Vec<Vec<f32>>) {
    let global: DedicatedWorkerGlobalScope  = js_sys::global().dyn_into().expect("Need a global object");
    /*let js_image = Array::new();
    for row in image.iter() {
        let js_row = Array::new();
        for &val in row.iter() {
            js_row.push(&JsValue::from_f64(val as f64));
        }
        js_image.push(&js_row);
    }
    let js_image: JsValue = js_image.into();*/
    let flat_img: Vec<f32> = image.clone().into_iter().flat_map(|x| x).collect();
    let array_buffer: js_sys::Float32Array = js_sys::Float32Array::new_with_length(flat_img.len() as u32);
    for (i, &val) in flat_img.iter().enumerate() {
        array_buffer.set_index(i as u32, val);
    }
    
    global.post_message(&array_buffer).unwrap();
}


#[wasm_bindgen]
pub fn startup() {
    set_panic_hook();
    console_log!("sjcitartup rust");
    let global: DedicatedWorkerGlobalScope = js_sys::global().dyn_into().expect("Need a global object");
    let message_handler = Closure::<dyn FnMut(_)>::new(|event: web_sys::MessageEvent| {
        let data = event.data();
        let data: Array = data.into();
        let image: Vec<Vec<f32>> = data.iter().map(|x| {
            let arr: Array = x.into();
            arr.iter().map(|y| y.as_f64().unwrap() as f32).collect()
        }).collect();
        console_log!("received");

        let mut line_art = line_art_arc.lock().unwrap();
        *line_art = Some(LineArt::new(500, image, &mut rand::thread_rng()));
        let mut annealer = annealer_arc.lock().unwrap();
        *annealer = Some(Annealer::new(0.5, 0.000005));
    });
    if let Err(e) = global.add_event_listener_with_callback("message", message_handler.as_ref().unchecked_ref()) {
        console_log!("Error adding event listener: {:?}", e);
    }
    message_handler.forget();


    let anneal_handler = Closure::<dyn FnMut(_)>::new(|_: web_sys::Event| {
        let global: DedicatedWorkerGlobalScope  = js_sys::global().dyn_into().expect("Need a global object");
        let mut line_art = line_art_arc.lock().unwrap();
        let mut annealer = annealer_arc.lock().unwrap();
        let mut rng = rand::thread_rng();
        //console_log!("annealing");
        if let (Some(ref mut line_art), Some(ref mut annealer)) = (&mut *line_art, &mut *annealer) {
            //console_log!("has image");
            let start_time = js_sys::Date::now();
            let mut iter_cnt = 0;
            while js_sys::Date::now() - start_time < ITER_INTERVAL as f64 {
                for _ in 0..ITERS {
                    annealer.anneal(line_art, &mut rng);
                    iter_cnt += 1;
                }
            }
            push_image(&line_art.image);
        }
    });

    let set_interval = global.set_interval_with_callback_and_timeout_and_arguments_0(anneal_handler.as_ref().unchecked_ref(), ITER_INTERVAL).unwrap();
    anneal_handler.forget();
}