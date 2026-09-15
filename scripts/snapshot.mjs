#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , url, ...rest] = process.argv;
if (!url) {
    console.error('Usage: node scripts/snapshot.mjs <url> [--theme=dark|light] [--width=1280] [--height=1600] [--out=file.png] [--dom=file.html] [--timeout=15000]');
    process.exit(2);
}
const options = Object.fromEntries(rest.map((arg) => { const [key, value] = arg.replace(/^--/, '').split('='); return [key, value === undefined ? true : value]; }));
const theme = options.theme || 'dark';
const width = Number(options.width || 1280);
const height = Number(options.height || 1600);
const timeout = Number(options.timeout || 15000);
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

const input = child.stdio[3];
const output = child.stdio[4];
let nextId = 1;
const pending = new Map();
const events = [];
let buffer = '';

output.on('data', (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf('\0')) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const message = JSON.parse(raw);
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        } else if (message.method) {
            events.push(message);
        }
    }
});

function send(method, params = {}, sessionId) {
    const id = nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    input.write(JSON.stringify(message) + '\0');
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(sessionId, expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return result.result.value;
}

async function main() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, sessionId);
    await send('Page.navigate', { url }, sessionId);

    const started = Date.now();
    let state = '';
    while (Date.now() - started < timeout) {
        state = await evaluate(sessionId, 'document.documentElement.dataset.capidocs || ""').catch(() => '');
        if (state === 'ready' || state === 'failed') break;
        await sleep(100);
    }
    await evaluate(sessionId, 'document.fonts.ready.then(() => true)').catch(() => false);
    await sleep(250);

    const errors = events
        .filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error'))
        .map((event) => event.method === 'Runtime.exceptionThrown'
            ? event.params.exceptionDetails.text + ' ' + (event.params.exceptionDetails.exception?.description || '')
            : event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));

    const summary = await evaluate(sessionId, `(() => ({
        title: document.title,
        h1: (document.querySelector('#main-content h1') || {}).textContent || '',
        sidebarLinks: document.querySelectorAll('.sidebar-nav-link').length,
        tocItems: document.querySelectorAll('.toc-item').length,
        highlighted: document.querySelectorAll('code.highlighted').length,
        errorPage: !!document.querySelector('#main-content .error-page'),
        theme: document.documentElement.getAttribute('data-theme'),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }))()`);

    if (options.out) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(options.out, Buffer.from(shot.data, 'base64'));
    }
    if (options.dom) {
        const dom = await evaluate(sessionId, 'document.documentElement.outerHTML');
        writeFileSync(options.dom, dom);
    }

    const result = { url, state, ...summary, errors };
    if (options.debug) {
        result.console = events.filter((event) => event.method === 'Runtime.consoleAPICalled').map((event) => event.params.type + ': ' + event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
    if (state !== 'ready' && options.debug) {
        result.resources = await evaluate(sessionId, "performance.getEntriesByType('resource').map((e) => e.name.replace(location.origin + '/', '') + ':' + Math.round(e.duration))");
        result.readyState = await evaluate(sessionId, 'document.readyState');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    if (state !== 'ready' || errors.length || summary.errorPage) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => child.kill());
