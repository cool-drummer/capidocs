#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , setArg, ...rest] = process.argv;
if (!setArg) {
    console.error('Usage: node scripts/render-diagrams.mjs <set.json> --out=<dir> [--formats=svg,png,pdf] [--theme=light|dark] [--scale=2] [--site=apps/site]');
    process.exit(2);
}
const options = Object.fromEntries(rest.map((arg) => { const [key, value] = arg.replace(/^--/, '').split('='); return [key, value === undefined ? true : value]; }));
const outDir = resolve(options.out || 'diagrams-export');
const formats = new Set(String(options.formats || 'svg,png,pdf').split(',').map((format) => format.trim()).filter(Boolean));
const theme = options.theme === 'dark' ? 'dark' : 'light';
const scale = Math.min(4, Math.max(1, Number(options.scale || 2)));
const siteDir = resolve(options.site || 'apps/site');
const port = 20000 + Math.floor(Math.random() * 20000);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const setText = readFileSync(resolve(setArg), 'utf8');

const server = spawn(process.execPath, [resolve('scripts/serve.mjs'), siteDir, String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']
});

const input = browser.stdio[3];
const output = browser.stdio[4];
const pending = new Map();
let nextId = 1;
let buffer = '';
output.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (message.id && pending.has(message.id)) {
            const { resolve: done, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else done(message.result);
        }
    }
});

function send(method, params = {}, sessionId) {
    const id = nextId++;
    input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    return new Promise((done, reject) => pending.set(id, { resolve: done, reject }));
}

async function evaluate(sessionId, expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
}

async function readLarge(sessionId, key) {
    const length = await evaluate(sessionId, `window.__render.store[${JSON.stringify(key)}].length`);
    const chunk = 4 * 1024 * 1024;
    let text = '';
    for (let offset = 0; offset < length; offset += chunk) {
        text += await evaluate(sessionId, `window.__render.store[${JSON.stringify(key)}].slice(${offset}, ${offset + chunk})`);
    }
    await evaluate(sessionId, `delete window.__render.store[${JSON.stringify(key)}]`);
    return text;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const SETUP = (set, renderTheme, renderScale) => `(async () => {
    const base = new URL('assets/js/diagram/', location.href);
    const load = (path) => import(new URL(path, base).href);
    const [model, layout, metrics, svg, fonts, raster, pdf, themes] = await Promise.all([
        load('model.js'), load('layout/index.js'), load('metrics.js'), load('render/svg.js'),
        load('render/fonts.js'), load('export/raster.js'), load('export/pdf.js'), load('theme.js')
    ]);
    await Promise.all(['400 13px Geist', '500 13px Geist', '600 13px Geist', '400 12px "Geist Mono"'].map((font) => document.fonts.load(font)));
    await document.fonts.ready;
    const result = model.validateDiagramSet(${set});
    if (!result.ok) return { ok: false, issues: result.issues.slice(0, 20) };
    const measure = metrics.createCanvasMeasure(document);
    const embed = await fonts.loadExportFonts({ doc: document });
    const toBase64 = async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return btoa(binary);
    };
    const set = result.set;
    const store = {};
    const pages = [];
    window.__render = {
        store,
        async one(id, wantSvg, wantPng, wantPdf) {
            const diagram = set.diagrams.find((entry) => entry.id === id);
            const scene = layout.layoutDiagram(diagram, { measure });
            const markup = svg.renderSvg(scene, { mode: 'export', theme: ${JSON.stringify(renderTheme)}, set, diagram, embedFontCss: embed, title: diagram.title });
            if (wantSvg) store[id + '.svg'] = markup;
            if (wantPng) {
                const tokens = themes.themeTokens(${JSON.stringify(renderTheme)});
                const blob = await raster.svgToRaster(markup, { width: scene.width, height: scene.height, scale: ${renderScale}, type: 'image/png', background: tokens.canvas });
                store[id + '.png'] = await toBase64(blob);
            }
            if (wantPdf) {
                const light = ${JSON.stringify(renderTheme)} === 'light' ? markup : svg.renderSvg(scene, { mode: 'export', theme: 'light', set, diagram, embedFontCss: embed, title: diagram.title });
                const blob = await raster.svgToRaster(light, { width: scene.width, height: scene.height, scale: 2, type: 'image/jpeg', background: themes.themeTokens('light').canvas, quality: 0.92 });
                pages.push({
                    width: scene.width,
                    height: scene.height,
                    jpeg: new Uint8Array(await blob.arrayBuffer()),
                    imageWidth: Math.round(scene.width * 2),
                    imageHeight: Math.round(scene.height * 2),
                    texts: svg.sceneTexts(scene, { measure })
                });
            }
            return { width: scene.width, height: scene.height };
        },
        async pdf() {
            const bytes = pdf.buildPdf(pages, { title: set.title, lang: set.lang });
            store['set.pdf'] = await toBase64(new Blob([bytes]));
            return bytes.length;
        }
    };
    return { ok: true, title: set.title, diagrams: set.diagrams.map((entry) => ({ id: entry.id, title: entry.title })) };
})()`;

try {
    await sleep(400);
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/diagrams.html` }, sessionId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await evaluate(sessionId, 'document.readyState').catch(() => '')) === 'complete') break;
        await sleep(100);
    }

    const setup = await evaluate(sessionId, SETUP(setText, theme, scale));
    if (!setup.ok) {
        console.error('The diagram set is not valid:');
        setup.issues.forEach((issue) => console.error(`  ${issue.path}: ${issue.message}`));
        process.exitCode = 1;
    } else {
        mkdirSync(outDir, { recursive: true });
        const wantSvg = formats.has('svg');
        const wantPng = formats.has('png');
        const wantPdf = formats.has('pdf');
        for (const [index, diagram] of setup.diagrams.entries()) {
            const prefix = `${String(index + 1).padStart(2, '0')}-${diagram.id}`;
            await evaluate(sessionId, `window.__render.one(${JSON.stringify(diagram.id)}, ${wantSvg}, ${wantPng}, ${wantPdf})`);
            if (wantSvg) writeFileSync(join(outDir, `${prefix}.svg`), await readLarge(sessionId, `${diagram.id}.svg`));
            if (wantPng) writeFileSync(join(outDir, `${prefix}.png`), Buffer.from(await readLarge(sessionId, `${diagram.id}.png`), 'base64'));
            process.stdout.write(`  ${prefix}\n`);
        }
        if (wantPdf) {
            await evaluate(sessionId, 'window.__render.pdf()');
            const file = join(outDir, `${String(setup.title).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagrams'}.pdf`);
            writeFileSync(file, Buffer.from(await readLarge(sessionId, 'set.pdf'), 'base64'));
            process.stdout.write(`  ${file}\n`);
        }
        process.stdout.write(`Rendered ${setup.diagrams.length} diagrams into ${outDir}\n`);
    }
} catch (error) {
    console.error('render failed:', error.message);
    process.exitCode = 1;
} finally {
    browser.kill();
    server.kill();
}
