import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function hasChrome() {
    return existsSync(CHROME);
}

const VIOLATION_HOOK = `document.addEventListener('securitypolicyviolation', (event) => {
    (window.__violations = window.__violations || []).push(event.violatedDirective + ' ' + event.blockedURI);
});`;

export async function openPage(url, { timeout = 20000, expression = 'null' } = {}) {
    const profile = mkdtempSync(join(tmpdir(), 'capidocs-chrome-'));
    const child = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        `--user-data-dir=${profile}`, '--remote-debugging-pipe', 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const input = child.stdio[3];
    const output = child.stdio[4];
    const pending = new Map();
    const events = [];
    let nextId = 1;
    let buffer = '';
    output.on('data', (chunk) => {
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf('\0')) !== -1) {
            const message = JSON.parse(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
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
    const send = (method, params = {}, sessionId) => {
        const id = nextId++;
        input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    };
    const evaluate = async (sessionId, source) => {
        const result = await send('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true }, sessionId);
        return result.result.value;
    };
    try {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Runtime.enable', {}, sessionId);
        await send('Log.enable', {}, sessionId);
        await send('Page.enable', {}, sessionId);
        await send('Page.addScriptToEvaluateOnNewDocument', { source: VIOLATION_HOOK }, sessionId);
        await send('Page.navigate', { url }, sessionId);
        const started = Date.now();
        let state = '';
        while (Date.now() - started < timeout) {
            state = await evaluate(sessionId, 'document.documentElement.dataset.capidocs || ""').catch(() => '');
            if (state === 'ready' || state === 'failed') break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        const value = await evaluate(sessionId, expression);
        const violations = await evaluate(sessionId, 'window.__violations || []');
        const errors = events.flatMap((event) => {
            if (event.method === 'Runtime.exceptionThrown') {
                const details = event.params.exceptionDetails;
                return [`${details.text} ${details.exception?.description ?? ''}`.trim()];
            }
            if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(event.params.type)) {
                return [event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')];
            }
            if (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params.entry.level)) {
                return [`${event.params.entry.source}: ${event.params.entry.text}`];
            }
            return [];
        });
        return { state, value, errors: [...errors, ...violations.map((entry) => `csp: ${entry}`)] };
    } finally {
        const exited = new Promise((resolve) => child.once('exit', resolve).once('error', resolve));
        child.kill();
        await exited;
        try {
            rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch (error) {
            console.warn(`Could not remove the temporary Chrome profile: ${error.message}`);
        }
    }
}
