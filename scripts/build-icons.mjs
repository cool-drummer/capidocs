#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const modules = resolve(import.meta.dirname, '../node_modules');
const lucideDir = join(modules, 'lucide-static/icons');
const simpleDir = join(modules, 'simple-icons');
const packageVersion = (name) => JSON.parse(readFileSync(join(modules, name, 'package.json'), 'utf8')).version;
const output = resolve(process.argv[2] ?? 'apps/site/assets/js/diagram/icons.js');

const LINE_ICONS = [
    'activity', 'alert-triangle', 'archive', 'arrow-left-right', 'arrow-right', 'arrow-up-right', 'audio-lines',
    'banknote', 'bell', 'book-open', 'bot', 'box', 'braces', 'brain', 'briefcase', 'bug', 'building', 'calendar',
    'calendar-clock', 'chart-bar', 'chart-line', 'chart-pie', 'check', 'check-circle', 'chevron-down', 'chevron-left',
    'chevron-right', 'chevron-up', 'clipboard', 'clipboard-check', 'clock', 'cloud', 'cloud-upload', 'code', 'cog',
    'compass', 'container', 'copy', 'cpu', 'credit-card', 'database', 'door-open', 'download', 'external-link', 'eye',
    'factory', 'file', 'file-audio', 'file-code', 'file-image', 'file-json', 'file-text', 'filter', 'fingerprint',
    'flag', 'flask-conical', 'folder', 'folder-lock', 'gauge', 'git-branch', 'git-merge', 'git-pull-request', 'globe',
    'graduation-cap', 'handshake', 'hard-drive', 'hash', 'headphones', 'heart', 'history', 'hotel', 'hourglass',
    'id-card', 'image', 'inbox', 'info', 'key', 'keyboard', 'landmark', 'languages', 'layers', 'layout-dashboard',
    'layout-grid', 'life-buoy', 'link', 'list', 'list-checks', 'list-tree', 'locate', 'lock', 'log-in', 'mail', 'map',
    'map-pin', 'maximize', 'message-square', 'mic', 'minimize', 'minus', 'monitor', 'moon', 'mouse-pointer-click',
    'network', 'package', 'panel-left', 'panel-right', 'pause', 'pen-tool', 'pencil', 'phone', 'play', 'plug', 'plus',
    'presentation', 'printer', 'puzzle', 'receipt', 'refresh-cw', 'repeat', 'rocket', 'route', 'save', 'scale', 'scan',
    'scan-line', 'search', 'send', 'server', 'server-cog', 'settings', 'share-2', 'shield', 'shield-check',
    'shopping-cart', 'skip-back', 'skip-forward', 'sliders-horizontal', 'smartphone', 'square-terminal', 'store',
    'sun', 'table', 'tag', 'tags', 'terminal', 'test-tube', 'timer', 'trash', 'truck', 'upload', 'user', 'user-check',
    'user-cog', 'users', 'video', 'wallet', 'webhook', 'wifi', 'workflow', 'wrench', 'x', 'x-circle', 'zap'
];

const LUCIDE_ALIASES = {
    'alert-triangle': ['triangle-alert', 'alert-triangle'],
    'chart-bar': ['chart-bar', 'chart-column', 'bar-chart'],
    'chart-line': ['chart-line', 'line-chart'],
    'chart-pie': ['chart-pie', 'pie-chart'],
    'check-circle': ['circle-check', 'check-circle'],
    'file-audio': ['file-audio', 'file-music', 'file-volume'],
    'filter': ['funnel', 'filter'],
    'fingerprint': ['fingerprint-pattern', 'fingerprint'],
    'locate': ['locate-fixed', 'locate'],
    'square-terminal': ['square-terminal', 'terminal-square'],
    'trash': ['trash-2', 'trash'],
    'x-circle': ['circle-x', 'x-circle']
};

const BRANDS = [
    'android', 'apple', 'cloudflare', 'diagramsdotnet', 'digitalocean', 'docker', 'eslint', 'github', 'githubactions',
    'google', 'googlechrome', 'inertia', 'javascript', 'laravel', 'linux', 'mermaid', 'nginx', 'nodedotjs', 'php',
    'playwright', 'pnpm', 'postgresql', 'redis', 'safari', 'sentry', 'stripe', 'tailwindcss', 'telegram', 'twilio',
    'typescript', 'ubuntu', 'vite', 'vitest', 'vuedotjs', 'whatsapp', 'zod'
];

const ATTRIBUTE = /([a-zA-Z-]+)="([^"]*)"/g;
const ELEMENT = /<(path|circle|rect|line|ellipse|polyline|polygon)\b([^>]*)\/?>/g;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-.,\s]+$/;

const num = (value) => Number(value ?? 0);
const fmt = (value) => String(Math.round(value * 1000) / 1000);

function attributes(source) {
    const result = {};
    for (const [, key, value] of source.matchAll(ATTRIBUTE)) result[key] = value;
    return result;
}

function pointsPath(points, close) {
    const pairs = points.trim().split(/[\s,]+/).map(Number);
    const parts = [];
    for (let index = 0; index < pairs.length; index += 2) parts.push(`${index ? 'L' : 'M'}${fmt(pairs[index])} ${fmt(pairs[index + 1])}`);
    return parts.join('') + (close ? 'Z' : '');
}

function ellipsePath(cx, cy, rx, ry) {
    return `M${fmt(cx - rx)} ${fmt(cy)}a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(rx * 2)} 0a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-rx * 2)} 0`;
}

function rectPath(a) {
    const x = num(a.x);
    const y = num(a.y);
    const w = num(a.width);
    const h = num(a.height);
    const rx = Math.min(num(a.rx ?? a.ry), w / 2);
    const ry = Math.min(num(a.ry ?? a.rx), h / 2);
    if (!rx && !ry) return `M${fmt(x)} ${fmt(y)}h${fmt(w)}v${fmt(h)}h${fmt(-w)}Z`;
    return [
        `M${fmt(x + rx)} ${fmt(y)}h${fmt(w - rx * 2)}`,
        `a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(ry)}v${fmt(h - ry * 2)}`,
        `a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(ry)}h${fmt(-(w - rx * 2))}`,
        `a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(-rx)} ${fmt(-ry)}v${fmt(-(h - ry * 2))}`,
        `a${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(rx)} ${fmt(-ry)}Z`
    ].join('');
}

function toPath(tag, a) {
    switch (tag) {
        case 'path': return a.d;
        case 'circle': return ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r));
        case 'ellipse': return ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
        case 'rect': return rectPath(a);
        case 'line': return `M${fmt(num(a.x1))} ${fmt(num(a.y1))}L${fmt(num(a.x2))} ${fmt(num(a.y2))}`;
        case 'polyline': return pointsPath(a.points, false);
        case 'polygon': return pointsPath(a.points, true);
        default: throw new Error(`Unsupported element ${tag}`);
    }
}

function readSvg(file) {
    const source = readFileSync(file, 'utf8');
    const root = attributes(source.match(/<svg\b([^>]*)>/)[1]);
    const paths = [...source.matchAll(ELEMENT)].map(([, tag, attrs]) => toPath(tag, attributes(attrs)));
    for (const path of paths) {
        if (!PATH_DATA.test(path)) throw new Error(`${file}: path data outside the allowed alphabet`);
    }
    return { viewBox: root.viewBox ?? '0 0 24 24', paths };
}

const brandData = JSON.parse(readFileSync(join(simpleDir, 'data/simple-icons.json'), 'utf8'));
const brandHex = new Map(brandData.map((entry) => [entry.slug, entry.hex]));

const icons = {};
const unresolved = [];
for (const name of LINE_ICONS) {
    const file = [...(LUCIDE_ALIASES[name] ?? []), name].find((candidate) => existsSync(join(lucideDir, `${candidate}.svg`)));
    if (!file) {
        unresolved.push(name);
        continue;
    }
    const icon = readSvg(join(lucideDir, `${file}.svg`));
    icons[name] = { viewBox: icon.viewBox, stroke: true, paths: icon.paths };
}
if (unresolved.length) {
    process.stderr.write(`lucide icons not found under any alias: ${unresolved.join(', ')}\n`);
    process.exit(1);
}

const REQUIRED_BRANDS = new Set(['cloudflare', 'digitalocean', 'github', 'githubactions', 'laravel', 'nginx', 'php', 'postgresql', 'redis', 'ubuntu']);
const skipped = [];
for (const slug of BRANDS) {
    let icon;
    try {
        icon = readSvg(join(simpleDir, 'icons', `${slug}.svg`));
    } catch {
        if (REQUIRED_BRANDS.has(slug)) {
            process.stderr.write(`required brand icon missing from Simple Icons: ${slug}\n`);
            process.exit(1);
        }
        skipped.push(slug);
        continue;
    }
    icons[`brand:${slug}`] = { viewBox: icon.viewBox, stroke: false, color: `#${brandHex.get(slug)}`, paths: icon.paths };
}

const lucideVersion = packageVersion('lucide-static');
const simpleVersion = packageVersion('simple-icons');
const header = [
    '/*',
    ` * Line icons from Lucide ${lucideVersion} (https://lucide.dev), ISC License.`,
    ' * Copyright (c) Lucide Icons and Contributors; portions derived from Feather, Copyright (c) 2013-present Cole Bemis (MIT).',
    ` * Brand icons ("brand:" prefix) from Simple Icons ${simpleVersion} (https://simpleicons.org), CC0 1.0 Universal.`,
    ' * Brand names and logos remain trademarks of their respective owners.',
    ' * Generated by scripts/build-icons.mjs; edit that script instead of this file.',
    ' */'
].join('\n');

const body = Object.keys(icons).sort().map((name) => `    ${JSON.stringify(name)}: ${JSON.stringify(icons[name])}`).join(',\n');
writeFileSync(output, `${header}\nexport const BUILTIN_ICONS = Object.freeze(Object.assign(Object.create(null), {\n${body}\n}));\n`);

process.stdout.write(`icons: ${Object.keys(icons).length} written to ${output}\n`);
if (skipped.length) process.stdout.write(`brands not available in this Simple Icons release: ${skipped.join(', ')}\n`);
