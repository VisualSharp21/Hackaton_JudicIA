import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(projectRoot, 'public');
const port = Number(process.env.FRONTEND_PORT || 5173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end('Method not allowed');
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end('Bad request');
    }
    const relativePath = pathname === '/' || /^\/audiencias(?:\/[^/]+)?\/?$/.test(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relativePath);
    if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500);
        return res.end(error.code === 'ENOENT' ? 'Not found' : 'Internal server error');
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    });
  })
  .listen(port, '127.0.0.1', () =>
    console.log(
      `Pulso TIC frontend em http://localhost:${port} (API esperada em http://localhost:${process.env.PORT || 3000})`,
    ),
  );
