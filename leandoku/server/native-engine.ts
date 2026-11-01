/**
 * Development server for the native engine: POST /check with a CheckRequest,
 * get the bridge's CheckResponse. The Vite dev server proxies /engine here.
 * For local development only; see the origin checks below.
 *
 *   npm run bridge:build && npm run engine:serve
 */
import { createServer } from 'node:http';
import { BridgeProcess } from './bridge-process.ts';

const port = Number(process.env.PORT ?? 8787);
const bridge = new BridgeProcess();

/**
 * Lean can run arbitrary code while elaborating (`#eval`), so this server must
 * only take requests from the developer's own pages. It listens on loopback,
 * sends no CORS headers, requires a JSON content type (which browsers will not
 * send cross-origin without a preflight this server never approves), and
 * refuses any browser Origin other than a local one.
 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin !== undefined && !LOCAL_ORIGIN.test(origin)) {
    res.writeHead(403).end('forbidden origin');
    return;
  }
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    res.writeHead(415).end('expected application/json');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/check') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c: Buffer) => (body += c.toString()));
  req.on('end', () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end('invalid JSON');
      return;
    }
    bridge
      .request(parsed)
      .then((out) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out)))
      .catch((e: Error) => res.writeHead(503).end(e.message));
  });
}).listen(port, '127.0.0.1', () => console.log(`native engine on http://127.0.0.1:${port}`));
