import { parseDiagramSetJson, validateDiagramSet } from './model.js';
import { mountExplorer, readStoredSet, safeStorage } from './explorer.js';
import { createDiagramTranslator, friendlyError } from './i18n.js';
import { escapeHtml } from '../escape.js';
import { applyTheme } from './theme.js';

const DEFAULT_SOURCE = 'config/diagrams/capidocs.json';
export const HANDOFF_KEY = 'capidocs.diagrams.handoff';

const fail = (code) => Object.assign(new Error(code), { code });

async function loadFromUrl(src) {
    let url;
    try {
        url = new URL(src, window.location.href);
    } catch {
        throw fail('source_not_allowed');
    }
    if (url.origin !== window.location.origin) throw fail('source_not_allowed');
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw fail('load_failed');
    const result = parseDiagramSetJson(await response.text());
    if (!result.ok) {
        console.error('diagram explorer: invalid diagram set', result.issues);
        throw fail('invalid_model');
    }
    return result.set;
}

function takeHandoff(storage) {
    try {
        const raw = storage?.getItem(HANDOFF_KEY);
        if (!raw) return null;
        storage.removeItem(HANDOFF_KEY);
        const result = validateDiagramSet(JSON.parse(raw));
        return result.ok ? result.set : null;
    } catch (error) {
        console.error('diagram explorer: handoff could not be read', error);
        return null;
    }
}

function renderFailure(root, error) {
    const t = createDiagramTranslator(document.documentElement.lang);
    applyTheme(document.documentElement, window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.classList.add('dx-app');
    root.innerHTML = `
        <div class="dx-failure" role="alert">
            <h1 class="dx-display dx-display-sm">${escapeHtml(t('app.title'))}</h1>
            <p class="dx-lede">${escapeHtml(friendlyError(t, error))}</p>
            <p><a class="dx-btn dx-btn-strong" href="diagrams.html">${escapeHtml(t('gallery.home'))}</a></p>
        </div>`;
    document.documentElement.dataset.capidocs = 'failed';
}

async function boot() {
    const root = document.getElementById('app');
    if (!root) return;
    const storage = safeStorage();
    const params = new URLSearchParams(window.location.search);
    let set;
    let source;
    try {
        const handoff = params.has('handoff') ? takeHandoff(storage) : null;
        const src = params.get('src');
        if (handoff) {
            set = handoff;
            source = 'url';
        } else if (src) {
            set = await loadFromUrl(src);
            source = 'url';
        } else {
            const stored = readStoredSet(storage);
            const validated = stored ? validateDiagramSet(stored) : null;
            if (validated?.ok) {
                set = validated.set;
                source = 'local';
            } else {
                set = await loadFromUrl(DEFAULT_SOURCE);
                source = 'default';
            }
        }
    } catch (error) {
        console.error('diagram explorer: start failed', error);
        renderFailure(root, error);
        return;
    }
    document.documentElement.lang = set.lang || 'es';
    const explorer = mountExplorer(root, {
        set,
        source,
        storage,
        onForget: async () => {
            try {
                explorer.setSet(await loadFromUrl(DEFAULT_SOURCE), 'default');
            } catch (error) {
                console.error('diagram explorer: default set failed', error);
                renderFailure(root, error);
            }
        }
    });
    window.capidocsDiagrams = explorer;
}

boot();
