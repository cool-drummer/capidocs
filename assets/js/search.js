(function () {
    let indexPromise = null;
    let modal = null;
    let input = null;
    let resultsEl = null;
    let results = [];
    let activeIndex = 0;
    let isOpen = false;

    function slug(text) {
        return String(text || '')
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    function esc(text) {
        const d = document.createElement('div');
        d.textContent = text == null ? '' : text;
        return d.innerHTML;
    }

    function collectText(section) {
        return [
            section.title,
            section.content,
            section.note,
            section.warning,
            Array.isArray(section.list) ? section.list.join(' ') : '',
            section.table ? (section.table.headers || []).join(' ') : ''
        ].filter(Boolean).join(' ');
    }

    function buildIndex(config) {
        const entries = [];
        const pages = config.pages || {};
        const endpoints = config.endpoints || {};
        const seenPage = new Set();

        (config.navigation || []).forEach(item => {
            if (item.type === 'page') {
                entries.push({ type: 'page', title: item.title, route: item.id, subtitle: 'Guía', text: item.title });
                seenPage.add(item.id);
            }
        });

        Object.entries(pages).forEach(([id, page]) => {
            const c = page.content || {};
            const pageTitle = c.title || (c.hero && c.hero.title) || id;
            if (!seenPage.has(id)) {
                entries.push({ type: 'page', title: pageTitle, route: id, subtitle: 'Página', text: [pageTitle, c.description].filter(Boolean).join(' ') });
                seenPage.add(id);
            }
            (c.sections || []).forEach(section => {
                if (!section.title) return;
                entries.push({
                    type: 'section',
                    title: section.title,
                    route: id,
                    anchor: slug(section.title),
                    subtitle: pageTitle,
                    text: collectText(section)
                });
            });
        });

        Object.entries(endpoints).forEach(([id, ep]) => {
            entries.push({
                type: 'endpoint',
                title: ep.title || id,
                method: ep.method || '',
                path: ep.path || '',
                route: id,
                subtitle: [ep.method, ep.path].filter(Boolean).join(' '),
                text: [ep.title, ep.description, ep.path, ep.method].filter(Boolean).join(' ')
            });
        });

        return entries;
    }

    function hasVersionOverride() {
        try { return !!localStorage.getItem('capidocs_spec_url'); } catch (e) { return false; }
    }

    function buildFromConfig() {
        return (window.configLoader ? window.configLoader.load() : Promise.reject('no loader')).then(buildIndex);
    }

    function loadIndex() {
        if (!indexPromise) {
            if (hasVersionOverride()) {
                indexPromise = buildFromConfig().catch(function () { return []; });
            } else {
                indexPromise = fetch('search-index.json')
                    .then(function (r) { if (!r.ok) throw new Error('no prebuilt index'); return r.json(); })
                    .catch(buildFromConfig)
                    .catch(function () { return []; });
            }
        }
        return indexPromise;
    }

    function scoreEntry(entry, q, terms) {
        const title = (entry.title || '').toLowerCase();
        const text = (entry.text || '').toLowerCase();
        const sub = (entry.subtitle || '').toLowerCase();
        const haystack = title + ' ' + sub + ' ' + text;

        for (let i = 0; i < terms.length; i++) {
            if (haystack.indexOf(terms[i]) === -1) return 0;
        }

        let s = 0;
        if (title === q) s += 1000;
        else if (title.indexOf(q) === 0) s += 240;
        else if (title.indexOf(q) !== -1) s += 130;
        if (entry.path && entry.path.toLowerCase().indexOf(q) !== -1) s += 160;

        terms.forEach(function (t) {
            if (title.indexOf(t) !== -1) s += 40;
            if (sub.indexOf(t) !== -1) s += 14;
            if (text.indexOf(t) !== -1) s += 8;
        });

        if (entry.type === 'endpoint') s += 10;
        else if (entry.type === 'page') s += 6;
        return s;
    }

    function search(entries, query) {
        const q = query.trim().toLowerCase();
        if (!q) return entries.filter(function (e) { return e.type !== 'section'; }).slice(0, 8);
        const terms = q.split(/\s+/).filter(Boolean);
        return entries
            .map(function (e) { return { e: e, s: scoreEntry(e, q, terms) }; })
            .filter(function (r) { return r.s > 0; })
            .sort(function (a, b) { return b.s - a.s; })
            .slice(0, 12)
            .map(function (r) { return r.e; });
    }

    function typeIcon(entry) {
        if (entry.type === 'endpoint') {
            const m = (entry.method || 'get').toLowerCase();
            return '<span class="search-method method-badge method-' + esc(m) + '">' + esc(entry.method || 'GET') + '</span>';
        }
        if (entry.type === 'section') return '<i class="fas fa-hashtag search-ico"></i>';
        return '<i class="fas fa-file-lines search-ico"></i>';
    }

    function renderResults() {
        if (!results.length) {
            const term = (input && input.value ? input.value : '').trim();
            resultsEl.innerHTML =
                '<div class="search-empty">' +
                '<div class="search-empty-icon"><i class="fas fa-magnifying-glass"></i></div>' +
                '<p class="search-empty-title">' + esc(ui('search_empty_title', 'Nada para')) + ' «' + esc(term) + '»</p>' +
                '<p class="search-empty-hint">' + esc(ui('search_empty_hint', 'Revisa la ortografía o prueba con otro término.')) + '</p>' +
                '</div>';
            return;
        }
        resultsEl.innerHTML = results.map(function (entry, i) {
            const sub = entry.type === 'endpoint'
                ? '<code class="search-sub-code">' + esc(entry.path) + '</code>'
                : '<span class="search-sub">' + esc(entry.subtitle || '') + '</span>';
            return '<button class="search-result' + (i === activeIndex ? ' active' : '') + '" data-i="' + i + '">' +
                '<span class="search-result-lead">' + typeIcon(entry) + '</span>' +
                '<span class="search-result-body">' +
                '<span class="search-result-title">' + esc(entry.title) + '</span>' +
                sub +
                '</span>' +
                '<span class="search-result-enter"><i class="fas fa-turn-down fa-rotate-90"></i></span>' +
                '</button>';
        }).join('');
    }

    function updateActive(delta) {
        if (!results.length) return;
        activeIndex = (activeIndex + delta + results.length) % results.length;
        renderResults();
        const el = resultsEl.querySelector('.search-result.active');
        if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function goTo(entry) {
        close();
        const route = entry.route;
        if (window.capiDocsRouter && typeof window.capiDocsRouter.navigate === 'function') {
            window.capiDocsRouter.navigate(route);
        } else {
            window.location.hash = '#' + route;
        }
        if (entry.anchor) {
            let tries = 0;
            const timer = setInterval(function () {
                const target = document.getElementById(entry.anchor);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    clearInterval(timer);
                } else if (++tries > 20) {
                    clearInterval(timer);
                }
            }, 60);
        }
    }

    function onInput() {
        loadIndex().then(function (entries) {
            results = search(entries, input.value);
            activeIndex = 0;
            renderResults();
        });
    }

    function ensureModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.className = 'search-modal-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', ui('search_aria', 'Buscar en la documentación'));
        modal.innerHTML =
            '<div class="search-modal">' +
            '<div class="search-input-wrap">' +
            '<i class="fas fa-magnifying-glass search-input-ico"></i>' +
            '<input type="text" class="search-input" placeholder="' + esc(ui('search_placeholder', 'Buscar documentación...')) + '" autocomplete="off" spellcheck="false" aria-label="' + esc(ui('search_label', 'Buscar')) + '">' +
            '<kbd class="search-kbd">Esc</kbd>' +
            '</div>' +
            '<div class="search-results" role="listbox"></div>' +
            '<div class="search-foot">' +
            '<span><kbd class="search-kbd">↑</kbd><kbd class="search-kbd">↓</kbd> ' + esc(ui('search_hint_navigate', 'navegar')) + '</span>' +
            '<span><kbd class="search-kbd">↵</kbd> ' + esc(ui('search_hint_open', 'abrir')) + '</span>' +
            '<span><kbd class="search-kbd">esc</kbd> ' + esc(ui('search_hint_close', 'cerrar')) + '</span>' +
            '</div>' +
            '</div>';
        document.body.appendChild(modal);
        input = modal.querySelector('.search-input');
        resultsEl = modal.querySelector('.search-results');

        input.addEventListener('input', onInput);
        modal.addEventListener('mousedown', function (e) {
            if (e.target === modal) close();
        });
        resultsEl.addEventListener('mousemove', function (e) {
            const btn = e.target.closest('.search-result');
            if (btn) {
                const i = parseInt(btn.getAttribute('data-i'), 10);
                if (i !== activeIndex) { activeIndex = i; renderResults(); }
            }
        });
        resultsEl.addEventListener('click', function (e) {
            const btn = e.target.closest('.search-result');
            if (btn) goTo(results[parseInt(btn.getAttribute('data-i'), 10)]);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); updateActive(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); if (results[activeIndex]) goTo(results[activeIndex]); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
    }

    function open() {
        ensureModal();
        if (isOpen) return;
        isOpen = true;
        modal.classList.add('open');
        document.body.classList.add('search-open');
        input.value = '';
        onInput();
        setTimeout(function () { input.focus(); }, 20);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        modal.classList.remove('open');
        document.body.classList.remove('search-open');
    }

    function ui(key, fallback) {
        return (window.configLoader && window.configLoader.ui) ? window.configLoader.ui(key, fallback) : fallback;
    }

    function buildTrigger() {
        const content = document.querySelector('.navbar-content');
        const nav = document.getElementById('navbar-nav');
        if (!content || content.querySelector('.navbar-search')) return;
        const btn = document.createElement('button');
        btn.className = 'navbar-search';
        btn.type = 'button';
        btn.setAttribute('aria-label', ui('search_label', 'Buscar'));
        btn.innerHTML =
            '<i class="fas fa-magnifying-glass"></i>' +
            '<span class="navbar-search-label"></span>' +
            '<kbd class="navbar-search-kbd"><span class="search-cmd"></span>K</kbd>';
        btn.querySelector('.navbar-search-label').textContent = ui('search_label', 'Buscar');
        btn.addEventListener('click', open);
        content.insertBefore(btn, nav || null);

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const cmd = btn.querySelector('.search-cmd');
        if (cmd) cmd.textContent = isMac ? '⌘' : 'Ctrl ';
    }

    function initTrigger() {
        if (window.configLoader) {
            window.configLoader.load().then(buildTrigger).catch(buildTrigger);
        } else {
            buildTrigger();
        }
    }

    document.addEventListener('keydown', function (e) {
        const key = (e.key || '').toLowerCase();
        if ((e.metaKey || e.ctrlKey) && key === 'k') {
            e.preventDefault();
            isOpen ? close() : open();
        } else if (key === '/' && !isOpen && !/^(input|textarea|select)$/i.test((e.target.tagName || '')) && !e.target.isContentEditable) {
            e.preventDefault();
            open();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTrigger);
    } else {
        initTrigger();
    }

    window.capiDocsSearch = { open: open, close: close };
})();
