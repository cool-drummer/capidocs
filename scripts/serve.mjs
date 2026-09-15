#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const [, , dir = 'apps/site', portArg = '8877'] = process.argv;
const root = resolve(dir);
const port = Number(portArg);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.sh': 'text/plain; charset=utf-8',
    '.py': 'text/plain; charset=utf-8',
    '.http': 'text/plain; charset=utf-8'
};

const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
        response.writeHead(403).end();
        return;
    }
    let stats;
    try {
        stats = statSync(file);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
    }
    if (stats.isDirectory()) {
        response.writeHead(301, { Location: pathname + '/' }).end();
        return;
    }
    response.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stats.size,
        'Cache-Control': 'no-store'
    });
    createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', 1024, () => {
    console.warn(`capidocs serving ${root} at http://127.0.0.1:${port}/`);
});
