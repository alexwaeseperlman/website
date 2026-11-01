/**
 * The Lean library files (.olean) shipped to the browser as one gzipped
 * archive: `LDPK1\n`, a 4-byte little-endian header length, a JSON header
 * listing `{ path, size, sha256 }`, then the file bytes in header order.
 * Hashes are checked on unpack so a truncated or corrupted download fails
 * loudly instead of confusing Lean.
 */
const MAGIC = 'LDPK1\n';

export interface PackedFile {
  path: string;
  data: Uint8Array;
}

interface HeaderEntry {
  path: string;
  size: number;
  sha256: string;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function unpackLibrary(gzipped: Uint8Array): Promise<PackedFile[]> {
  const raw = await gunzip(gzipped);
  const magic = new TextDecoder().decode(raw.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error('library pack: bad magic');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const headerLen = view.getUint32(MAGIC.length, true);
  let at = MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(at, at + headerLen))) as HeaderEntry[];
  at += headerLen;
  const out: PackedFile[] = [];
  for (const e of header) {
    const data = raw.subarray(at, at + e.size);
    if (data.length !== e.size) throw new Error(`library pack: ${e.path} is truncated`);
    if ((await sha256(data)) !== e.sha256) throw new Error(`library pack: ${e.path} is corrupted`);
    out.push({ path: e.path, data });
    at += e.size;
  }
  return out;
}

/** Build a pack (Node only; used by `wasm/pack-library.ts`). */
export async function packLibrary(files: PackedFile[]): Promise<Uint8Array> {
  const header: HeaderEntry[] = [];
  for (const f of files) header.push({ path: f.path, size: f.data.length, sha256: await sha256(f.data) });
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const total = MAGIC.length + 4 + headerBytes.length + files.reduce((n, f) => n + f.data.length, 0);
  const raw = new Uint8Array(total);
  raw.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(raw.buffer).setUint32(MAGIC.length, headerBytes.length, true);
  let at = MAGIC.length + 4;
  raw.set(headerBytes, at);
  at += headerBytes.length;
  for (const f of files) {
    raw.set(f.data, at);
    at += f.data.length;
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
