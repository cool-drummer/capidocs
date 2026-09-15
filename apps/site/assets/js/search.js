import { escapeHtml } from './escape.js';
import { buildSearchIndex } from './spec-utils.js';
import { hasSpecOverride } from './spec-loader.js';

function scoreEntry(entry, query, terms) {
    const title = (entry.title || '').toLowerCase();
    const text = (entry.text || '').toLowerCase();
    const subtitle = (entry.subtitle || '').toLowerCase();
    const haystack = `${title} ${subtitle} ${text}`;
    if (terms.some((term) => !haystack.includes(term))) return 0;

    let score = 0;
    if (title === query) score += 1000;
    else if (title.startsWith(query)) score += 240;
    else if (title.includes(query)) score += 130;
    if (entry.path && entry.path.toLowerCase().includes(query)) score += 160;
    terms.forEach((term) => {
        if (title.includes(term)) score += 40;
        if (subtitle.includes(term)) score += 14;
        if (text.includes(term)) score += 8;
    });
    if (entry.type === 'endpoint') score += 10;
    else if (entry.type === 'page') score += 6;
    return score;
}

export function searchEntries(entries, query) {
    const q = query.trim().toLowerCase();
    if (!q) return entries.filter((entry) => entry.type !== 'section').slice(0, 8);
    const terms = q.split(/\s+/).filter(Boolean);
    return entries
        .map((entry) => ({ entry, score: scoreEntry(entry, q, terms) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map((item) => item.entry);
}

export class Search {
    constructor({ spec, t, navigate, indexUrl = 'search-index.json' }) {
        this.spec = spec;
        this.t = t;
        this.navigate = navigate;
        this.indexUrl = indexUrl;
        this.indexPromise = null;
        this.modal = null;
        this.results = [];
        this.activeIndex = 0;
        this.isOpen = false;
        this.bindShortcuts();
        this.renderTrigger();
    }

    loadIndex() {
        if (!this.indexPromise) {
            const local = () => buildSearchIndex(this.spec, { guide: this.t('nav_guides', 'Guía'), page: this.t('page', 'Página') });
            this.indexPromise = hasSpecOverride()
                ? Promise.resolve(local())
                : fetch(this.indexUrl)
                    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('no prebuilt index'))))
                    .catch(local);
        }
        return this.indexPromise;
    }

    typeIcon(entry) {
        if (entry.type === 'endpoint') {
            const method = (entry.method || 'get').toLowerCase();
            return `<span class="search-method method-badge method-${escapeHtml(method)}">${escapeHtml(entry.method || 'GET')}</span>`;
        }
        if (entry.type === 'section') return '<i class="fas fa-hashtag search-ico"></i>';
        return '<i class="fas fa-file-lines search-ico"></i>';
    }

    renderResults() {
        if (!this.results.length) {
            const term = (this.input.value || '').trim();
            this.resultsEl.innerHTML = `
                <div class="search-empty">
                    <div class="search-empty-icon"><i class="fas fa-magnifying-glass"></i></div>
                    <p class="search-empty-title">${escapeHtml(this.t('search_empty_title', 'Nada para'))} «${escapeHtml(term)}»</p>
                    <p class="search-empty-hint">${escapeHtml(this.t('search_empty_hint', 'Revisa la ortografía o prueba con otro término.'))}</p>
                </div>`;
            return;
        }
        this.resultsEl.innerHTML = this.results.map((entry, i) => {
            const subtitle = entry.type === 'endpoint'
                ? `<code class="search-sub-code">${escapeHtml(entry.path)}</code>`
                : `<span class="search-sub">${escapeHtml(entry.subtitle || '')}</span>`;
            return `
                <button class="search-result${i === this.activeIndex ? ' active' : ''}" data-i="${i}">
                    <span class="search-result-lead">${this.typeIcon(entry)}</span>
                    <span class="search-result-body">
                        <span class="search-result-title">${escapeHtml(entry.title)}</span>
                        ${subtitle}
                    </span>
                    <span class="search-result-enter"><i class="fas fa-turn-down fa-rotate-90"></i></span>
                </button>`;
        }).join('');
    }

    move(delta) {
        if (!this.results.length) return;
        this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length;
        this.renderResults();
        const active = this.resultsEl.querySelector('.search-result.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    async goTo(entry) {
        this.close();
        await this.navigate(entry.route);
        if (!entry.anchor) return;
        const target = document.getElementById(entry.anchor);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    onInput() {
        this.loadIndex().then((entries) => {
            this.results = searchEntries(entries, this.input.value);
            this.activeIndex = 0;
            this.renderResults();
        });
    }

    ensureModal() {
        if (this.modal) return;
        const modal = document.createElement('div');
        modal.className = 'search-modal-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', this.t('search_aria', 'Buscar en la documentación'));
        modal.innerHTML = `
            <div class="search-modal">
                <div class="search-input-wrap">
                    <i class="fas fa-magnifying-glass search-input-ico"></i>
                    <input type="text" class="search-input" placeholder="${escapeHtml(this.t('search_placeholder', 'Buscar documentación...'))}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(this.t('search_label', 'Buscar'))}">
                    <kbd class="search-kbd">Esc</kbd>
                </div>
                <div class="search-results" role="listbox"></div>
                <div class="search-foot">
                    <span><kbd class="search-kbd">↑</kbd><kbd class="search-kbd">↓</kbd> ${escapeHtml(this.t('search_hint_navigate', 'navegar'))}</span>
                    <span><kbd class="search-kbd">↵</kbd> ${escapeHtml(this.t('search_hint_open', 'abrir'))}</span>
                    <span><kbd class="search-kbd">esc</kbd> ${escapeHtml(this.t('search_hint_close', 'cerrar'))}</span>
                </div>
            </div>`;
        document.body.appendChild(modal);
        this.modal = modal;
        this.input = modal.querySelector('.search-input');
        this.resultsEl = modal.querySelector('.search-results');

        this.input.addEventListener('input', () => this.onInput());
        modal.addEventListener('mousedown', (event) => {
            if (event.target === modal) this.close();
        });
        this.resultsEl.addEventListener('mousemove', (event) => {
            const button = event.target.closest('.search-result');
            if (!button) return;
            const index = parseInt(button.getAttribute('data-i'), 10);
            if (index !== this.activeIndex) {
                this.activeIndex = index;
                this.renderResults();
            }
        });
        this.resultsEl.addEventListener('click', (event) => {
            const button = event.target.closest('.search-result');
            if (button) this.goTo(this.results[parseInt(button.getAttribute('data-i'), 10)]);
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); this.move(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); this.move(-1); }
            else if (event.key === 'Enter') { event.preventDefault(); if (this.results[this.activeIndex]) this.goTo(this.results[this.activeIndex]); }
            else if (event.key === 'Escape') { event.preventDefault(); this.close(); }
        });
    }

    open() {
        this.ensureModal();
        if (this.isOpen) return;
        this.isOpen = true;
        this.modal.classList.add('open');
        document.body.classList.add('search-open');
        this.input.value = '';
        this.onInput();
        this.input.focus();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.modal.classList.remove('open');
        document.body.classList.remove('search-open');
    }

    renderTrigger() {
        const content = document.querySelector('.navbar-content');
        const nav = document.getElementById('navbar-nav');
        if (!content || content.querySelector('.navbar-search')) return;
        const button = document.createElement('button');
        button.className = 'navbar-search';
        button.type = 'button';
        button.setAttribute('aria-label', this.t('search_label', 'Buscar'));
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        button.innerHTML = `
            <i class="fas fa-magnifying-glass"></i>
            <span class="navbar-search-label">${escapeHtml(this.t('search_label', 'Buscar'))}</span>
            <kbd class="navbar-search-kbd"><span class="search-cmd">${isMac ? '⌘' : 'Ctrl '}</span>K</kbd>`;
        button.addEventListener('click', () => this.open());
        content.insertBefore(button, nav || null);
    }

    bindShortcuts() {
        document.addEventListener('keydown', (event) => {
            const key = (event.key || '').toLowerCase();
            const typing = /^(input|textarea|select)$/i.test(event.target.tagName || '') || event.target.isContentEditable;
            if ((event.metaKey || event.ctrlKey) && key === 'k') {
                event.preventDefault();
                if (this.isOpen) this.close();
                else this.open();
            } else if (key === '/' && !this.isOpen && !typing) {
                event.preventDefault();
                this.open();
            }
        });
        document.addEventListener('click', (event) => {
            if (event.target.closest('[data-action="open-search"]')) {
                event.preventDefault();
                this.open();
            }
        });
    }
}
