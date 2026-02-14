/* tslint:disable */
/* eslint-disable */
/**
*/
export class PitchDetector {
  free(): void;
/**
* @param {number} sample_rate
* @param {number} fft_size
* @param {Uint8Array} model_bytes
* @returns {PitchDetector}
*/
  static new(sample_rate: number, fft_size: number, model_bytes: Uint8Array): PitchDetector;
/**
* @param {Float32Array} audio_data
* @returns {Float32Array}
*/
  put_pitch(audio_data: Float32Array): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_pitchdetector_free: (a: number) => void;
  readonly pitchdetector_new: (a: number, b: number, c: number, d: number) => number;
  readonly pitchdetector_put_pitch: (a: number, b: number, c: number, d: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {SyncInitInput} module
*
* @returns {InitOutput}
*/
export function initSync(module: SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
