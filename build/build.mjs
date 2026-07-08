#!/usr/bin/env node
// capidocs light build (no dependencies).
// Generates: search-index.json, llms.txt, llms-full.txt
// The site works WITHOUT this build; these are optional enhancements.
//
// Usage: node build/build.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = join(root, 'config/api-spec.json');

const EXT_LANG = { sh: 'bash', bash: 'bash', curl: 'bash', py: 'python', js: 'javascript', ts: 'typescript', json: 'json', http: 'http', yaml: 'yaml', yml: 'yaml', txt: 'text' };

function normalizeCode(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function resolveCode(node) {
    if (Array.isArray(node)) { node.forEach(resolveCode); return; }
    if (!node || typeof node !== 'object') return;
    ['code', 'content'].forEach(function (k) {
        if (Array.isArray(node[k]) && node[k].every(function (x) { return typeof x === 'string'; })) {
            node[k] = node[k].join('\n');
        }
    });
    const fileKey = ['file', 'code_file'].find(function (k) { return typeof node[k] === 'string'; });
    if (fileKey) {
        const p = join(root, node[fileKey]);
        const target = ('code' in node) ? 'code' : ('content' in node) ? 'content' : ('tech' in node) ? 'code' : 'content';
        try {
            node[target] = normalizeCode(readFileSync(p, 'utf8'));
            if (!node.language) { const ext = extname(node[fileKey]).slice(1).toLowerCase(); if (EXT_LANG[ext]) node.language = EXT_LANG[ext]; }
        } catch (e) { node[target] = '// missing: ' + node[fileKey]; }
    }
    Object.keys(node).forEach(function (k) { if (k !== 'file' && k !== 'code_file') resolveCode(node[k]); });
}

function slug(text) {
    return String(text || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function sectionText(s) {
    return [s.title, s.content, s.note, s.warning, Array.isArray(s.list) ? s.list.join(' ') : '',
        s.callout ? [s.callout.title, s.callout.content].join(' ') : '']
        .filter(Boolean).join(' ');
}

function buildSearchIndex(config) {
    const entries = [];
    const pages = config.pages || {};
    const endpoints = config.endpoints || {};
    const seen = new Set();
    (config.navigation || []).forEach(function (n) { if (n.type === 'page') { entries.push({ type: 'page', title: n.title, route: n.id, subtitle: 'Guía', text: n.title }); seen.add(n.id); } });
    Object.entries(pages).forEach(function (e) {
        const id = e[0], page = e[1], c = page.content || {};
        const pt = c.title || (c.hero && c.hero.title) || id;
        if (!seen.has(id)) { entries.push({ type: 'page', title: pt, route: id, subtitle: 'Página', text: [pt, c.description].filter(Boolean).join(' ') }); seen.add(id); }
        (c.sections || []).forEach(function (s) { if (s.title) entries.push({ type: 'section', title: s.title, route: id, anchor: slug(s.title), subtitle: pt, text: sectionText(s) }); });
    });
    Object.entries(endpoints).forEach(function (e) {
        const id = e[0], ep = e[1];
        entries.push({ type: 'endpoint', title: ep.title || id, method: ep.method || '', path: ep.path || '', route: id, subtitle: [ep.method, ep.path].filter(Boolean).join(' '), text: [ep.title, ep.description, ep.path, ep.method].filter(Boolean).join(' ') });
    });
    return entries;
}

function orderedRoutes(config) {
    const out = [], seen = new Set();
    const push = function (id, title) { if (id && !seen.has(id)) { seen.add(id); out.push({ id: id, title: title || id }); } };
    (config.navigation || []).forEach(function (n) { if (n.type === 'page' || !n.type) push(n.id, n.title); });
    (config.sections || []).forEach(function (s) { (s.pages || []).forEach(function (p) { push(p.id, p.title); }); (s.endpoints || []).forEach(function (ep) { push(ep.id, ep.title); }); });
    return out;
}

function pageMarkdown(config, route) {
    const pages = config.pages || {}, endpoints = config.endpoints || {};
    const lines = [];
    if (pages[route]) {
        const c = pages[route].content || {};
        if (c.hero) {
            lines.push('# ' + (c.hero.title || route));
            if (c.hero.subtitle) lines.push('', c.hero.subtitle);
            return lines.join('\n');
        }
        lines.push('# ' + (c.title || route));
        if (c.description) lines.push('', c.description);
        (c.sections || []).forEach(function (s) {
            lines.push('', '## ' + s.title);
            if (s.content) lines.push('', s.content);
            if (s.note) lines.push('', '> Note: ' + s.note);
            if (s.warning) lines.push('', '> Warning: ' + s.warning);
            if (s.callout) lines.push('', '> ' + (s.callout.title ? s.callout.title + ': ' : '') + (s.callout.content || ''));
            (s.list || []).forEach(function (i) { lines.push('- ' + i); });
            if (s.table) { lines.push('', '| ' + s.table.headers.join(' | ') + ' |', '| ' + s.table.headers.map(function () { return '---'; }).join(' | ') + ' |'); (s.table.rows || []).forEach(function (r) { lines.push('| ' + r.join(' | ') + ' |'); }); }
            if (s.code) lines.push('', '```' + (s.code.language || ''), s.code.content || '', '```');
            (s.code_group || []).forEach(function (g) { lines.push('', '```' + (g.language || ''), g.code || g.content || '', '```'); });
            (s.fields || []).forEach(function (f) { lines.push('- `' + f.name + '` (' + (f.type || '') + (f.required ? ', required' : '') + ')' + (f.description ? ' — ' + f.description : '')); });
        });
    } else if (endpoints[route]) {
        const ep = endpoints[route];
        lines.push('# ' + (ep.title || route));
        lines.push('', '`' + (ep.method || 'GET') + ' ' + (ep.path || '') + '`');
        if (ep.description) lines.push('', ep.description);
        (ep.code_examples || []).forEach(function (ce) { lines.push('', '### ' + (ce.name || ce.tech), '', '```' + (ce.language || ''), ce.code || '', '```'); });
    }
    return lines.join('\n');
}

function main() {
    if (!existsSync(specPath)) { console.error('config/api-spec.json not found'); process.exit(1); }
    const config = JSON.parse(readFileSync(specPath, 'utf8'));
    resolveCode(config);

    const api = config.api || {};
    const site = config.site_config || {};
    const routes = orderedRoutes(config);

    // search-index.json
    const index = buildSearchIndex(config);
    writeFileSync(join(root, 'search-index.json'), JSON.stringify(index));
    console.log('search-index.json  ' + index.length + ' entries');

    // llms.txt (concise map)
    const llms = [];
    llms.push('# ' + (api.name || site.name || 'API Documentation'));
    if (api.description) llms.push('', '> ' + api.description);
    if (api.base_url) llms.push('', 'Base URL: ' + api.base_url);
    llms.push('', '## Pages');
    routes.forEach(function (r) {
        const md = pageMarkdown(config, r.id).split('\n').filter(Boolean);
        const summary = (md[2] || md[1] || '').replace(/^[#>`\s]+/, '').slice(0, 140);
        llms.push('- [' + r.title + '](#' + r.id + ')' + (summary ? ': ' + summary : ''));
    });
    writeFileSync(join(root, 'llms.txt'), llms.join('\n') + '\n');
    console.log('llms.txt           ' + routes.length + ' pages');

    // llms-full.txt (full content)
    const full = [];
    full.push('# ' + (api.name || 'API Documentation') + ' — full documentation', '');
    routes.forEach(function (r) { full.push(pageMarkdown(config, r.id), '', '---', ''); });
    writeFileSync(join(root, 'llms-full.txt'), full.join('\n'));
    console.log('llms-full.txt      ' + full.join('\n').length + ' bytes');

    // sitemap.xml + robots.txt
    const siteUrl = (site.site_url || 'https://example.com').replace(/\/$/, '');
    const urls = routes.map(function (r) {
        return '  <url><loc>' + siteUrl + '/#' + r.id + '</loc></url>';
    }).join('\n');
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n';
    writeFileSync(join(root, 'sitemap.xml'), sitemap);
    const robots = 'User-agent: *\nAllow: /\n\nSitemap: ' + siteUrl + '/sitemap.xml\n# LLM-friendly docs\n# ' + siteUrl + '/llms.txt\n# ' + siteUrl + '/llms-full.txt\n';
    writeFileSync(join(root, 'robots.txt'), robots);
    console.log('sitemap.xml        ' + routes.length + ' urls');
    console.log('robots.txt         ok');

    console.log('\nBuild complete.');
}

main();
