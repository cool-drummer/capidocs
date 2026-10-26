#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [, , dir = 'apps/site', portArg = '8877'] = process.argv;
const root = resolve(dir);
const port = Number(portArg);

function siteHeaders() {
    const file = join(root, '_headers');
    if (!existsSync(file)) return {};
    const headers = {};
    let inAll = false;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        if (!/^\s/.test(line)) {
            inAll = line.trim() === '/*';
            continue;
        }
        const index = line.indexOf(':');
        if (inAll && index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return headers;
}

const extraHeaders = siteHeaders();

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
    if (file !== root && !file.startsWith(root + sep)) {
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
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', 1024, () => {
    console.warn(`capidocs serving ${root} at http://127.0.0.1:${port}/`);
});
