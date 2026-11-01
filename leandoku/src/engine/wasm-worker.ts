/// <reference lib="webworker" />
/** Runs the Lean bridge (wasm-host.ts) in a Web Worker. */
import { createHost } from './wasm-host';
import type { FromWorker, ToWorker } from './wasm-protocol';

declare const self: DedicatedWorkerGlobalScope;

const host = createHost((m: FromWorker) => self.postMessage(m), self.location.href);
self.addEventListener('error', (e) => host.crash(e.error ?? e.message));
self.addEventListener('unhandledrejection', (e) => host.crash(e.reason));
self.addEventListener('message', (e: MessageEvent<ToWorker>) => host.handle(e.data));
