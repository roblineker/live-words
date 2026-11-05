// Tiny static server. The mic, WebGPU and module workers need a real http origin,
// so the page cannot be opened straight from disk.
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5177;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

const logDir = join(root, 'logs');

// The page posts performance summaries here; one JSON object per line.
async function handleLog(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) { res.writeHead(413).end(); return; }
  }
  try {
    const entry = JSON.parse(body);
    await mkdir(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(join(logDir, `perf-${day}.jsonl`), JSON.stringify(entry) + '\n');
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (req.method === 'POST' && path === '/log') return handleLog(req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // Cross-origin isolation lets the CPU (WASM) backend use several threads.
      // "credentialless" keeps the CDN and Google Fonts loading without extra headers.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Live Words: http://127.0.0.1:${port}`));
