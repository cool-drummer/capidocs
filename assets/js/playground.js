(function () {
    function ui(key, fallback) {
        return (window.configLoader && window.configLoader.ui) ? window.configLoader.ui(key, fallback) : fallback;
    }

    async function send(pg) {
        const method = (pg.getAttribute('data-method') || 'GET').toUpperCase();
        const base = pg.getAttribute('data-base') || '';
        const path = pg.getAttribute('data-path') || '';
        const headers = {};
        const query = new URLSearchParams();

        pg.querySelectorAll('.playground-input').forEach(function (inp) {
            const kind = inp.getAttribute('data-kind');
            const name = inp.getAttribute('data-name');
            const val = inp.value;
            if (!val) return;
            if (kind === 'header') headers[name] = val;
            else if (kind === 'query') query.append(name, val);
        });

        let url = base + path;
        const qs = query.toString();
        if (qs) url += (url.indexOf('?') === -1 ? '?' : '&') + qs;

        const opts = { method: method, headers: headers };
        const bodyEl = pg.querySelector('.playground-body');
        if (bodyEl && bodyEl.value.trim() && method !== 'GET' && method !== 'HEAD') {
            opts.body = bodyEl.value;
            const hasCT = Object.keys(headers).some(function (k) { return k.toLowerCase() === 'content-type'; });
            if (!hasCT) headers['Content-Type'] = 'application/json';
        }

        const respBox = pg.querySelector('.playground-response');
        const statusEl = pg.querySelector('.playground-status');
        const timeEl = pg.querySelector('.playground-time');
        const bodyOut = pg.querySelector('.playground-response-body');
        const btn = pg.querySelector('.playground-send');

        respBox.hidden = false;
        statusEl.textContent = ui('sending', 'Enviando…');
        statusEl.className = 'playground-status';
        timeEl.textContent = '';
        bodyOut.textContent = '';
        if (btn) btn.disabled = true;

        const t0 = (window.performance && performance.now) ? performance.now() : 0;
        try {
            const res = await fetch(url, opts);
            const ms = Math.round(((window.performance && performance.now) ? performance.now() : 0) - t0);
            const text = await res.text();
            let pretty = text;
            try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* not json */ }
            statusEl.textContent = res.status + ' ' + res.statusText;
            statusEl.className = 'playground-status ' + (res.ok ? 'ok' : 'err');
            timeEl.textContent = ms + ' ms';
            bodyOut.textContent = pretty;
            if (typeof Prism !== 'undefined') Prism.highlightElement(bodyOut);
        } catch (err) {
            console.error('Playground request failed:', err);
            statusEl.textContent = ui('playground_error_status', 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
            statusEl.className = 'playground-status err';
            bodyOut.textContent = ui('playground_error_body', 'No se pudo completar la petición. Vuelve a intentarlo en un momento.');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    document.addEventListener('click', function (e) {
        const btn = e.target.closest('.playground-send');
        if (btn) {
            e.preventDefault();
            const pg = btn.closest('.playground');
            if (pg) send(pg);
        }
    });
})();
