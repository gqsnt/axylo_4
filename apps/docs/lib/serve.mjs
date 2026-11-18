// A static file server, for the browser tests and the screenshot script. The site is served from its own
// directory, the deployment root, so a link that leaves it fails. The caller stops what it started with `close()`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './examples.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ts': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

export async function serve(root = repoRoot) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: relative => `http://127.0.0.1:${port}/${relative.replace(/^\//, '')}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}
