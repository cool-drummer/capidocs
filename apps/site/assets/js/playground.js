import { highlightElement } from './highlighter.js';

async function send(playground, t) {
    const method = (playground.getAttribute('data-method') || 'GET').toUpperCase();
    const base = playground.getAttribute('data-base') || '';
    const path = playground.getAttribute('data-path') || '';
    const headers = {};
    const query = new URLSearchParams();

    playground.querySelectorAll('.playground-input').forEach((input) => {
        const kind = input.getAttribute('data-kind');
        const name = input.getAttribute('data-name');
        if (!input.value) return;
        if (kind === 'header') headers[name] = input.value;
        else if (kind === 'query') query.append(name, input.value);
    });

    let url = base + path;
    const queryString = query.toString();
    if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;

    const options = { method, headers };
    const bodyField = playground.querySelector('.playground-body');
    if (bodyField && bodyField.value.trim() && method !== 'GET' && method !== 'HEAD') {
        options.body = bodyField.value;
        if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }

    const responseBox = playground.querySelector('.playground-response');
    const statusEl = playground.querySelector('.playground-status');
    const timeEl = playground.querySelector('.playground-time');
    const bodyOut = playground.querySelector('.playground-response-body');
    const button = playground.querySelector('.playground-send');

    responseBox.hidden = false;
    statusEl.textContent = t('sending', 'Enviando…');
    statusEl.className = 'playground-status';
    timeEl.textContent = '';
    bodyOut.textContent = '';
    if (button) button.disabled = true;

    const started = performance.now();
    try {
        const response = await fetch(url, options);
        const elapsed = Math.round(performance.now() - started);
        const text = await response.text();
        let pretty = text;
        try {
            pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
            pretty = text;
        }
        statusEl.textContent = `${response.status} ${response.statusText}`;
        statusEl.className = `playground-status ${response.ok ? 'ok' : 'err'}`;
        timeEl.textContent = `${elapsed} ms`;
        bodyOut.textContent = pretty;
        highlightElement(bodyOut);
    } catch (error) {
        console.error('Playground request failed:', error);
        statusEl.textContent = t('playground_error_status', 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
        statusEl.className = 'playground-status err';
        bodyOut.textContent = t('playground_error_body', 'No se pudo completar la petición. Vuelve a intentarlo en un momento.');
    } finally {
        if (button) button.disabled = false;
    }
}

export function bindPlayground({ t }) {
    document.addEventListener('click', (event) => {
        const button = event.target.closest('.playground-send');
        if (!button) return;
        event.preventDefault();
        const playground = button.closest('.playground');
        if (playground) send(playground, t);
    });
}
