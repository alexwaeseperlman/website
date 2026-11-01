import { EngineUnavailableError, type Engine } from './engine';
import { parseCheckResponse, type CheckRequest, type CheckResponse } from './protocol';

/** Talks to `server/native-engine.ts` over HTTP. Used in development. */
export class NativeHttpEngine implements Engine {
  readonly identity: string;

  constructor(private readonly endpoint = '/engine/check') {
    this.identity = `native:${endpoint}`;
  }

  async check(req: CheckRequest): Promise<CheckResponse> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    } catch (e) {
      throw new EngineUnavailableError(`native engine unreachable: ${String(e)}`);
    }
    if (!res.ok) throw new EngineUnavailableError(`native engine: ${res.status} ${await res.text()}`);
    return parseCheckResponse(await res.json(), req);
  }

  dispose(): void {}
}
