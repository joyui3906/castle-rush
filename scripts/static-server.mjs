import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safeResolvePath(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.resolve(ROOT, `.${normalized}`);
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url ?? '/');
  const fullPath = safeResolvePath(parsed.pathname ?? '/');
  if (!fullPath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(fullPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      send(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const stream = fs.createReadStream(fullPath);

    res.writeHead(200, { 'Content-Type': contentType });
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        send(res, 500, 'Internal Server Error');
      } else {
        res.destroy();
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Static server listening on http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the previous server or run with PORT=<port>.`);
    process.exit(1);
    return;
  }
  console.error(error);
  process.exit(1);
});
