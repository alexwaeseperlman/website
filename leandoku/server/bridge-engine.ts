import { EngineUnavailableError, type Engine } from '../src/engine/engine';
import { parseCheckResponse, type CheckRequest, type CheckResponse } from '../src/engine/protocol';
import { BridgeProcess } from './bridge-process';

/** The native bridge as an `Engine`, for tests and scripts running in Node. */
export class BridgeEngine implements Engine {
  readonly identity = 'native-process';
  private readonly proc: BridgeProcess;

  constructor(binary?: string) {
    this.proc = new BridgeProcess(binary);
  }

  async check(req: CheckRequest): Promise<CheckResponse> {
    let raw: unknown;
    try {
      raw = await this.proc.request(req);
    } catch (e) {
      throw new EngineUnavailableError(e instanceof Error ? e.message : String(e));
    }
    return parseCheckResponse(raw, req);
  }

  dispose(): void {
    this.proc.dispose();
  }
}
