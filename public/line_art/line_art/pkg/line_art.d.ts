/* tslint:disable */
/* eslint-disable */

export class Face {
    free(): void;
    [Symbol.dispose](): void;
    edges(): Uint16Array;
    iteration(): number;
    loss(): number;
    constructor(darkness: Float32Array, width: number, height: number, nodes: number, iterations: number);
    nodes(): Float32Array;
    step(): boolean;
    widths(): Float32Array;
}

export class PathFace {
    free(): void;
    [Symbol.dispose](): void;
    blur_pass(iterations: number, pencil: boolean): void;
    dot(): number;
    edges(): Uint16Array;
    iteration(): number;
    loss(): number;
    constructor(darkness: Float32Array, width: number, height: number, nodes: number, iterations: number, airbrush: boolean, ridge: number, learn_ridge: boolean, graphite: boolean);
    nodes(): Float32Array;
    profile(): Float32Array;
    ridge(): number;
    shown(): Float32Array;
    step(): boolean;
    widths(): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_face_free: (a: number, b: number) => void;
    readonly __wbg_pathface_free: (a: number, b: number) => void;
    readonly face_edges: (a: number) => [number, number];
    readonly face_iteration: (a: number) => number;
    readonly face_loss: (a: number) => number;
    readonly face_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly face_nodes: (a: number) => [number, number];
    readonly face_step: (a: number) => number;
    readonly face_widths: (a: number) => [number, number];
    readonly pathface_blur_pass: (a: number, b: number, c: number) => void;
    readonly pathface_dot: (a: number) => number;
    readonly pathface_edges: (a: number) => [number, number];
    readonly pathface_iteration: (a: number) => number;
    readonly pathface_loss: (a: number) => number;
    readonly pathface_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly pathface_nodes: (a: number) => [number, number];
    readonly pathface_profile: (a: number) => [number, number];
    readonly pathface_ridge: (a: number) => number;
    readonly pathface_shown: (a: number) => [number, number];
    readonly pathface_step: (a: number) => number;
    readonly pathface_widths: (a: number) => [number, number];
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
