/* tslint:disable */
/* eslint-disable */

export class Face {
    free(): void;
    [Symbol.dispose](): void;
    edges(): Uint16Array;
    constructor(darkness: Float32Array, width: number, height: number, nodes: number, sigma: number, lambda: number);
    nodes(): Float32Array;
    run(proposals: number): number;
    schedule(): number;
    widths(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_face_free: (a: number, b: number) => void;
    readonly face_edges: (a: number) => [number, number];
    readonly face_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly face_nodes: (a: number) => [number, number];
    readonly face_run: (a: number, b: number) => number;
    readonly face_schedule: (a: number) => number;
    readonly face_widths: (a: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
