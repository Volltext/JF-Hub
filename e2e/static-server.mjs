// Kleiner Webserver für die Browser-Demo im Rauchtest: liefert einen Ordner unter einem Unterpfad aus,
// so wie GitHub Pages (…/JF-Hub/demo/). Aufruf: node static-server.mjs <port> <pfad> <ordner>
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const [port, prefix, dir] = process.argv.slice(2);
const root = resolve(dir);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/health') return res.end('ok');
  if (!path.startsWith(prefix)) return res.writeHead(404).end('Nicht gefunden');
  let file = normalize(join(root, path.slice(prefix.length)));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    return res.writeHead(404).end('Nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(Number(port), '127.0.0.1');
