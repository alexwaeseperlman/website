/**
 * Development server for the native engine: POST /check with a CheckRequest,
 * get the bridge's CheckResponse. The Vite dev server proxies /engine here.
 *
 *   npm run bridge:build && npm run engine:serve
 */
import { createServer } from 'node:http';
import { BridgeProcess } from './bridge-process.ts';

const port = Number(process.env.PORT ?? 8787);
const bridge = new BridgeProcess();

createServer((req, res) => {
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
}).listen(port, () => console.log(`native engine on http://localhost:${port}`));
