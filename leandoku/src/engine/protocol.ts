/**
 * Wire format shared with the Lean bridge (`lean/Bridge/Protocol.lean`).
 * Responses are validated on arrival: a missing or malformed field is an
 * error, never a guessed default.
 */
export const PROTOCOL_VERSION = 1;

export interface Range {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface Hyp {
  id: string;
  name: string;
  inaccessible: boolean;
  type: string;
  value?: string;
}

export interface Goal {
  id: string;
  tag: string;
  hyps: Hyp[];
  target: string;
}

export interface TacticStep {
  range: Range;
  kind: string;
  goalsBefore: Goal[];
  goalsAfter: Goal[];
}

export interface Message {
  severity: 'error' | 'warning' | 'info';
  range: Range;
  text: string;
}

export interface Completion {
  theoremName: string;
  exists_: boolean;
  axioms: string[];
}

export interface CheckRequest {
  version: number;
  requestId: string;
  source: string;
  theoremName?: string;
}

export interface CheckResponse {
  version: number;
  requestId: string;
  messages: Message[];
  tactics: TacticStep[];
  completion?: Completion;
}

export class ProtocolError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ProtocolError(`${where}: expected object`);
  return v as Obj;
}
function str(o: Obj, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new ProtocolError(`${where}.${k}: expected string`);
  return v;
}
function num(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new ProtocolError(`${where}.${k}: expected natural number`);
  return v;
}
function bool(o: Obj, k: string, where: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new ProtocolError(`${where}.${k}: expected boolean`);
  return v;
}
function arr<T>(o: Obj, k: string, where: string, each: (v: unknown, w: string) => T): T[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new ProtocolError(`${where}.${k}: expected array`);
  return v.map((x, i) => each(x, `${where}.${k}[${i}]`));
}

function range(v: unknown, w: string): Range {
  const o = obj(v, w);
  return {
    startLine: num(o, 'startLine', w),
    startCol: num(o, 'startCol', w),
    endLine: num(o, 'endLine', w),
    endCol: num(o, 'endCol', w),
  };
}
function hyp(v: unknown, w: string): Hyp {
  const o = obj(v, w);
  const h: Hyp = { id: str(o, 'id', w), name: str(o, 'name', w), inaccessible: bool(o, 'inaccessible', w), type: str(o, 'type', w) };
  if (o['value'] !== undefined && o['value'] !== null) h.value = str(o, 'value', w);
  return h;
}
function goal(v: unknown, w: string): Goal {
  const o = obj(v, w);
  return { id: str(o, 'id', w), tag: str(o, 'tag', w), hyps: arr(o, 'hyps', w, hyp), target: str(o, 'target', w) };
}
function tactic(v: unknown, w: string): TacticStep {
  const o = obj(v, w);
  return {
    range: range(o['range'], `${w}.range`),
    kind: str(o, 'kind', w),
    goalsBefore: arr(o, 'goalsBefore', w, goal),
    goalsAfter: arr(o, 'goalsAfter', w, goal),
  };
}
function message(v: unknown, w: string): Message {
  const o = obj(v, w);
  const severity = str(o, 'severity', w);
  if (severity !== 'error' && severity !== 'warning' && severity !== 'info') {
    throw new ProtocolError(`${w}.severity: unknown "${severity}"`);
  }
  return { severity, range: range(o['range'], `${w}.range`), text: str(o, 'text', w) };
}

/** Validate a bridge response against the request it answers. */
export function parseCheckResponse(raw: unknown, req: CheckRequest): CheckResponse {
  const o = obj(raw, 'response');
  if (typeof o['error'] === 'string') throw new ProtocolError(`bridge error: ${o['error']}`);
  const version = num(o, 'version', 'response');
  if (version !== PROTOCOL_VERSION) throw new ProtocolError(`bridge speaks protocol ${version}, client ${PROTOCOL_VERSION}`);
  const requestId = str(o, 'requestId', 'response');
  if (requestId !== req.requestId) throw new ProtocolError(`response for ${requestId}, expected ${req.requestId}`);
  const res: CheckResponse = {
    version,
    requestId,
    messages: arr(o, 'messages', 'response', message),
    tactics: arr(o, 'tactics', 'response', tactic),
  };
  if (req.theoremName !== undefined) {
    const c = obj(o['completion'], 'response.completion');
    res.completion = {
      theoremName: str(c, 'theoremName', 'completion'),
      exists_: bool(c, 'exists_', 'completion'),
      axioms: arr(c, 'axioms', 'completion', (v, w) => {
        if (typeof v !== 'string') throw new ProtocolError(`${w}: expected string`);
        return v;
      }),
    };
    if (res.completion.theoremName !== req.theoremName) throw new ProtocolError('completion is for a different theorem');
  }
  return res;
}
