// Zero-dependency static server for the Nonsense Tickets canvas.
// `serve` mangles paths on Windows and hides index.html behind a directory
// listing, so we do it ourselves.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Resolve a URL path to a file inside ROOT, or null if it escapes / is missing.
async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = normalize(join(ROOT, decoded));
  const rel = relative(ROOT, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;

  try {
    const info = await stat(target);
    if (!info.isDirectory()) return { path: target, size: info.size };
    const index = join(target, 'index.html');
    const indexInfo = await stat(index);
    return { path: index, size: indexInfo.size };
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const found = await resolve(req.url || '/');
  if (!found) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 ${req.url}`);
    console.log(`404 ${req.url}`);
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(found.path).toLowerCase()] || 'application/octet-stream',
    'content-length': found.size,
    'cache-control': 'no-cache',
  });
  createReadStream(found.path).pipe(res);
  console.log(`200 ${req.url}`);
}).listen(PORT, () => {
  console.log(`Nonsense Tickets → http://localhost:${PORT}/`);
});
