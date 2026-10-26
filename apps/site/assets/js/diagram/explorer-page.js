import { parseDiagramSetJson, validateDiagramSet } from './model.js';
import { clearSavedData, markSavedRecord, mountExplorer, readSavedRecord, safeLocale, storageAreas } from './explorer.js';
import { createDiagramTranslator, friendlyError } from './i18n.js';
import { escapeHtml } from '../escape.js';
import { applyTheme } from './theme.js';
import { HANDOFF_KEY } from './blocks.js';

const DEFAULT_SOURCE = 'config/diagrams/capidocs.json';

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

function takeHandoff(area) {
    try {
        const raw = area?.getItem(HANDOFF_KEY);
        if (!raw) return null;
        area.removeItem(HANDOFF_KEY);
        const result = validateDiagramSet(JSON.parse(raw));
        return result.ok ? result.set : null;
    } catch (error) {
        console.error('diagram explorer: handoff could not be read', error);
        return null;
    }
}

function prepareScreen(root) {
    applyTheme(document.documentElement, window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.classList.add('dx-app');
    return createDiagramTranslator(document.documentElement.lang);
}

function renderFailure(root, error) {
    const t = prepareScreen(root);
    root.innerHTML = `
        <div class="dx-failure" role="alert">
            <h1 class="dx-display dx-display-sm">${escapeHtml(t('app.title'))}</h1>
            <p class="dx-lede">${escapeHtml(friendlyError(t, error))}</p>
            <p><a class="dx-btn dx-btn-strong" href="diagrams.html">${escapeHtml(t('gallery.home'))}</a></p>
        </div>`;
    document.documentElement.dataset.capidocs = 'failed';
}

export function renderRecovery(root, areas) {
    const t = prepareScreen(root);
    root.innerHTML = `
        <div class="dx-failure" role="alert">
            <h1 class="dx-display dx-display-sm">${escapeHtml(t('recovery.title'))}</h1>
            <p class="dx-lede">${escapeHtml(t('recovery.body'))}</p>
            <p><button type="button" class="dx-btn dx-btn-strong" data-recovery-clear>${escapeHtml(t('recovery.clear'))}</button></p>
        </div>`;
    root.querySelector('[data-recovery-clear]').addEventListener('click', () => {
        clearSavedData(areas);
        window.location.replace(window.location.pathname);
    });
    document.documentElement.dataset.capidocs = 'failed';
}

async function boot() {
    const root = document.getElementById('app');
    if (!root) return;
    const areas = storageAreas(window);
    const params = new URLSearchParams(window.location.search);
    let set;
    let source;
    let saved = null;
    try {
        const handoff = params.has('handoff') ? takeHandoff(areas.local) : null;
        const src = params.get('src');
        if (handoff) {
            set = handoff;
            source = 'url';
        } else if (src) {
            set = await loadFromUrl(src);
            source = 'url';
        } else {
            saved = readSavedRecord(areas);
            if (saved && saved.verified !== true) {
                renderRecovery(root, areas);
                return;
            }
            const validated = saved ? validateDiagramSet(saved.set) : null;
            if (validated?.ok) {
                set = validated.set;
                source = 'local';
                markSavedRecord(areas, false);
            } else {
                if (saved) clearSavedData(areas);
                saved = null;
                set = await loadFromUrl(DEFAULT_SOURCE);
                source = 'default';
            }
        }
    } catch (error) {
        console.error('diagram explorer: start failed', error);
        renderFailure(root, error);
        return;
    }
    document.documentElement.lang = safeLocale(set.lang);
    let explorer;
    try {
        explorer = mountExplorer(root, {
            set,
            source,
            storages: areas,
            remember: Boolean(saved?.remember),
            savedAt: saved?.savedAt ?? null,
            onRendered: () => {
                if (source === 'local') markSavedRecord(areas, true);
            },
            onForget: async () => {
                try {
                    explorer.setSet(await loadFromUrl(DEFAULT_SOURCE), 'default');
                } catch (error) {
                    console.error('diagram explorer: default set failed', error);
                    renderFailure(root, error);
                }
            }
        });
    } catch (error) {
        console.error('diagram explorer: the explorer could not start', error);
        if (source === 'local') renderRecovery(root, areas);
        else renderFailure(root, error);
        return;
    }
    window.capidocsDiagrams = explorer;
}

boot();
