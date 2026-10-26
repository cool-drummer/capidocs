import { serializeDiagramSet, validateDiagramSet } from '../model.js';
import { collectModules, resolveSpecifier } from './modules.js';
import { bytesToBase64, cspHash, sha256 } from './sha256.js';

export const STANDALONE_IDS = {
    set: 'capidocs-diagram-set',
    modules: 'capidocs-modules',
    root: 'capidocs-standalone'
};

export const STANDALONE_ASSETS = {
    stylesheets: ['assets/css/diagram-viewer.css', 'assets/css/diagrams.css'],
    fonts: [
        { family: 'Geist', file: 'assets/fonts/geist-sans.woff2' },
        { family: 'Geist Mono', file: 'assets/fonts/geist-mono.woff2' }
    ]
};

const MEDIA_TYPES = {
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp'
};

const BASE_STYLE = ':root{color-scheme:light dark}html,body{margin:0}body{background:Canvas;color:CanvasText;font-family:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}';

const BOOTSTRAP = `(function(){var d=document,data=JSON.parse(d.getElementById("${STANDALONE_IDS.modules}").textContent),urls=[];data.modules.forEach(function(m,i){var s=m.source;m.deps.forEach(function(n){s=s.split(data.marker+n+data.marker).join(urls[n]);});urls[i]=URL.createObjectURL(new Blob([s],{type:"text/javascript"}));});import(urls[data.entry]).catch(function(e){d.documentElement.dataset.capidocs="failed";console.error(e);});})();`;

export function escapeJsonForHtml(json) {
    return json.replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function hex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultReaders() {
    let base;
    try {
        base = new URL('../../../../', import.meta.url);
    } catch {
        throw new Error('File readers are required in this context');
    }
    if (base.protocol === 'file:') {
        const fs = await import('node:fs/promises');
        return {
            readText: (path) => fs.readFile(new URL(path, base), 'utf8'),
            readBinary: async (path) => new Uint8Array(await fs.readFile(new URL(path, base)))
        };
    }
    const read = async (path) => {
        const response = await fetch(new URL(path, base), { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Could not read ${path} (${response.status})`);
        return response;
    };
    return {
        readText: async (path) => (await read(path)).text(),
        readBinary: async (path) => new Uint8Array(await (await read(path)).arrayBuffer())
    };
}

function dataUri(path, bytes) {
    const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    return `data:${MEDIA_TYPES[extension] ?? 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

async function inlineUrls(css, cssPath, readBinary) {
    const pattern = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;
    const targets = new Map();
    for (const match of css.matchAll(pattern)) {
        const reference = match[2];
        if (/^(?:data:|https?:|blob:|#|\/)/i.test(reference) || targets.has(reference)) continue;
        try {
            const path = resolveSpecifier(cssPath, reference.startsWith('.') ? reference : `./${reference}`);
            targets.set(reference, dataUri(path, await readBinary(path)));
        } catch {
            targets.set(reference, null);
        }
    }
    return css.replace(pattern, (match, quote, reference) => (targets.get(reference) ? `url("${targets.get(reference)}")` : match));
}

async function buildStyles({ readText, readBinary }) {
    const parts = [BASE_STYLE];
    for (const font of STANDALONE_ASSETS.fonts) {
        try {
            const bytes = await readBinary(font.file);
            parts.push(`@font-face{font-family:"${font.family}";src:url("${dataUri(font.file, bytes)}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}`);
        } catch {
            continue;
        }
    }
    for (const stylesheet of STANDALONE_ASSETS.stylesheets) {
        try {
            const css = await readText(stylesheet);
            parts.push(await inlineUrls(css, stylesheet, readBinary));
        } catch {
            parts.push('');
        }
    }
    return parts.join('\n').replace(/\r\n?/g, '\n').replace(/<\/(style)/gi, '<\\/$1');
}

async function buildModules(entry, readText) {
    const graph = await collectModules(entry, readText);
    const indexOf = new Map(graph.modules.map((module, index) => [module.path, index]));
    const marker = `__capidocs_${hex(sha256(graph.modules.map((module) => module.source).join('\u0000'))).slice(0, 16)}__`;
    const modules = graph.modules.map((module) => {
        let source = module.source;
        const deps = new Set();
        for (const entryImport of [...module.imports].sort((a, b) => b.start - a.start)) {
            const dependency = indexOf.get(entryImport.path);
            deps.add(dependency);
            source = `${source.slice(0, entryImport.start)}${marker}${dependency}${marker}${source.slice(entryImport.end)}`;
        }
        return { source: `${source}\n//# sourceURL=capidocs:///${module.path}\n`, deps: [...deps] };
    });
    return { marker, entry: indexOf.get(graph.entry), modules };
}

export async function buildStandaloneHtml({ set, title, lang, entry, readText, readBinary, allowStyleAttributes = false } = {}) {
    if (!entry) throw new TypeError('An entry module is required');
    const result = validateDiagramSet(set);
    if (!result.ok) {
        const issue = result.issues[0];
        throw new Error(`Invalid diagram set: ${issue ? `${issue.path}: ${issue.message}` : 'unknown issue'}`);
    }
    const defaults = readText && readBinary ? null : await defaultReaders();
    const readers = { readText: readText ?? defaults.readText, readBinary: readBinary ?? defaults.readBinary };

    const payload = await buildModules(entry, readers.readText);
    const css = await buildStyles(readers);
    const csp = [
        "default-src 'none'",
        `script-src ${cspHash(BOOTSTRAP)} blob:`,
        `style-src ${cspHash(css)}`,
        ...(allowStyleAttributes ? ["style-src-attr 'unsafe-inline'"] : []),
        'font-src data:',
        'img-src data: blob:',
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
    ].join('; ');
    const pageTitle = String(title ?? result.set.title);
    const pageLang = String(lang ?? result.set.lang ?? 'es');
    const setJson = escapeJsonForHtml(JSON.stringify(serializeDiagramSet(result.set)));
    const modulesJson = escapeJsonForHtml(JSON.stringify(payload));

    return [
        '<!doctype html>',
        `<html lang="${escapeHtml(pageLang)}">`,
        '<head>',
        '<meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="referrer" content="no-referrer">',
        '<meta name="generator" content="capidocs">',
        `<title>${escapeHtml(pageTitle)}</title>`,
        '<link rel="icon" href="data:,">',
        `<style>${css}</style>`,
        '</head>',
        '<body>',
        `<div id="${STANDALONE_IDS.root}"></div>`,
        `<script type="application/json" id="${STANDALONE_IDS.set}">${setJson}</script>`,
        `<script type="application/json" id="${STANDALONE_IDS.modules}">${modulesJson}</script>`,
        `<script>${BOOTSTRAP}</script>`,
        '</body>',
        '</html>',
        ''
    ].join('\n');
}
