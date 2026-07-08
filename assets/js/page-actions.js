(function () {
    function esc(t) { const d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }

    function pageMarkdown(config, route) {
        const pages = config.pages || {}, endpoints = config.endpoints || {};
        const out = [];
        if (pages[route]) {
            const c = pages[route].content || {};
            if (c.hero) {
                out.push('# ' + (c.hero.title || route));
                if (c.hero.subtitle) out.push('', c.hero.subtitle);
                return out.join('\n');
            }
            out.push('# ' + (c.title || route));
            if (c.description) out.push('', c.description);
            (c.sections || []).forEach(function (s) {
                out.push('', '## ' + s.title);
                if (s.content) out.push('', s.content);
                if (s.note) out.push('', '> Note: ' + s.note);
                if (s.warning) out.push('', '> Warning: ' + s.warning);
                if (s.callout) out.push('', '> ' + (s.callout.title ? s.callout.title + ': ' : '') + (s.callout.content || ''));
                (s.list || []).forEach(function (i) { out.push('- ' + i); });
                if (s.table) {
                    out.push('', '| ' + s.table.headers.join(' | ') + ' |', '| ' + s.table.headers.map(function () { return '---'; }).join(' | ') + ' |');
                    (s.table.rows || []).forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
                }
                if (s.code) out.push('', '```' + (s.code.language || ''), s.code.content || '', '```');
                (s.code_group || []).forEach(function (g) { out.push('', '```' + (g.language || ''), g.code || g.content || '', '```'); });
                (s.fields || []).forEach(function (f) { out.push('- `' + f.name + '` (' + (f.type || '') + (f.required ? ', required' : '') + ')' + (f.description ? ' — ' + f.description : '')); });
            });
        } else if (endpoints[route]) {
            const ep = endpoints[route];
            out.push('# ' + (ep.title || route), '', '`' + (ep.method || 'GET') + ' ' + (ep.path || '') + '`');
            if (ep.description) out.push('', ep.description);
            (ep.code_examples || []).forEach(function (ce) { out.push('', '### ' + (ce.name || ce.tech), '', '```' + (ce.language || ''), ce.code || '', '```'); });
        } else {
            out.push('# ' + route);
        }
        return out.join('\n');
    }

    function currentRoute(actions) {
        return (actions && actions.getAttribute('data-route')) || (location.hash.slice(1) || 'home');
    }

    function withMarkdown(actions, cb) {
        (window.configLoader ? window.configLoader.load() : Promise.reject()).then(function (config) {
            cb(pageMarkdown(config, currentRoute(actions)));
        }).catch(function () { cb('# ' + currentRoute(actions)); });
    }

    function flash(btn, text) {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> ' + text;
        setTimeout(function () { btn.innerHTML = original; }, 1400);
    }

    function closeAllMenus() {
        document.querySelectorAll('.page-actions.open').forEach(function (a) { a.classList.remove('open'); });
    }

    document.addEventListener('click', function (e) {
        const toggle = e.target.closest('[data-page-actions]');
        if (toggle) {
            e.preventDefault();
            const actions = toggle.closest('.page-actions');
            const wasOpen = actions.classList.contains('open');
            closeAllMenus();
            if (!wasOpen) actions.classList.add('open');
            return;
        }

        const item = e.target.closest('.page-actions-menu [data-action]');
        if (item) {
            e.preventDefault();
            const actions = item.closest('.page-actions');
            const action = item.getAttribute('data-action');
            withMarkdown(actions, function (md) {
                if (action === 'copy-md') {
                    (navigator.clipboard ? navigator.clipboard.writeText(md) : Promise.reject())
                        .then(function () { flash(item, 'Copiado'); })
                        .catch(function () { flash(item, 'No se pudo copiar'); });
                    return;
                }
                if (action === 'view-md') {
                    const w = window.open('', '_blank');
                    if (w) { w.document.title = 'Markdown'; const pre = w.document.createElement('pre'); pre.style.cssText = 'white-space:pre-wrap;font-family:ui-monospace,monospace;padding:24px;max-width:820px;margin:0 auto;line-height:1.5'; pre.textContent = md; w.document.body.appendChild(pre); }
                    closeAllMenus();
                    return;
                }
                const prompt = 'Estoy leyendo esta página de documentación de API (' + location.href + '). Ayúdame a entenderla y responde mis preguntas.\n\n' + md;
                if (action === 'open-claude') window.open('https://claude.ai/new?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
                else if (action === 'open-chatgpt') window.open('https://chatgpt.com/?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
                closeAllMenus();
            });
            return;
        }

        if (!e.target.closest('.page-actions')) closeAllMenus();
    });

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllMenus(); });
})();
