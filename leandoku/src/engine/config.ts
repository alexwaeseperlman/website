import { NativeHttpEngine } from './native-client';
import type { Engine } from './engine';

/**
 * Which engine the page uses. In development (`npm run dev`) the Vite server
 * proxies `/engine` to the native engine on this machine. The published page
 * has no engine until Lean runs in the browser, so it returns undefined there
 * and the game says so instead of pretending to check.
 */
export function engineEndpoint(): string | undefined {
  return import.meta.env.DEV ? '/engine' : undefined;
}

export function createEngine(endpoint: string): Engine {
  return new NativeHttpEngine(`${endpoint}/check`);
}
