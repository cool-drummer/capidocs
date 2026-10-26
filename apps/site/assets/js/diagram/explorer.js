import { escapeAttr, escapeHtml } from '../escape.js';
import { BUILTIN_ICONS } from './icons.js';
import { LIMITS, findDiagram, mergeDiagramSets, serializeDiagramSet } from './model.js';
import { approximateMeasure, createCanvasMeasure } from './metrics.js';
import { layoutDiagram } from './layout/index.js';
import { renderSvg, sceneTexts } from './render/svg.js';
import { loadExportFonts, setExportFontCss } from './render/fonts.js';
import { applyTheme, themeTokens } from './theme.js';
import { createDiagramTranslator, friendlyError } from './i18n.js';
import { ensureFonts, mountDiagram } from './viewer.js';

export const STORAGE_KEY = 'capidocs.diagrams.set.v1';
export const THEME_KEY = 'capidocs.diagrams.theme';
export const IMPORT_ACCEPT = '.json,.md,.markdown,.mmd,.drawio,.xml,.html,.htm';
const EXPORT_KINDS = ['svg', 'png', 'jpg', 'pdf', 'json', 'html'];
const STANDALONE_ENTRY = 'assets/js/diagram/standalone-entry.js';

const LOADERS = {
    importDiagramFile: () => import('./import/index.js').then((module) => module.importDiagramFile),
    svgToRaster: () => import('./export/raster.js').then((module) => module.svgToRaster),
    buildPdf: () => import('./export/pdf.js').then((module) => module.buildPdf),
    buildStandaloneHtml: () => import('./export/standalone.js').then((module) => module.buildStandaloneHtml),
    downloadBlob: () => import('./export/download.js').then((module) => module.downloadBlob)
};

export function icon(name, size = 16, className = 'dx-icon') {
    const entry = BUILTIN_ICONS[name];
    if (!entry) return '';
    const paint = entry.stroke
        ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
        : `fill="${escapeAttr(entry.color ?? 'currentColor')}"`;
    return `<svg class="${className}" width="${size}" height="${size}" viewBox="${escapeAttr(entry.viewBox)}" aria-hidden="true" focusable="false" ${paint}>${entry.paths.map((d) => `<path d="${escapeAttr(d)}"/>`).join('')}</svg>`;
}

export function readStoredSet(storage = safeStorage()) {
    try {
        const raw = storage?.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed.set ?? null : null;
    } catch {
        return null;
    }
}

export function safeStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export function parseRoute(hash) {
    const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean).map((part) => {
        try {
            return decodeURIComponent(part);
        } catch {
            return part;
        }
    });
    if (parts[0] === 'd' && parts[1]) return { view: 'diagram', diagram: parts[1], node: parts[2] ?? null };
    if (parts[0] === 'c' && parts[1]) return { view: 'category', category: parts[1] };
    return { view: 'home' };
}

export function diagramHref(diagramId, nodeId) {
    return `#/d/${encodeURIComponent(diagramId)}${nodeId ? `/${encodeURIComponent(nodeId)}` : ''}`;
}

function guessName(text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'pasted.json';
    if (/<mxfile|<mxGraphModel/i.test(trimmed)) return 'pasted.drawio';
    if (trimmed.startsWith('<')) return 'pasted.html';
    if (/^(?:%%[^\n]*\n\s*)*(?:graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram)/.test(trimmed)) return 'pasted.mmd';
    return 'pasted.md';
}

function slug(value) {
    return String(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
}

function countLabel(t, diagram) {
    return diagram.kind === 'sequence'
        ? t('gallery.participants', { count: diagram.participants.length })
        : t('gallery.nodes', { count: diagram.nodes.length });
}

export function thumbnailWindow(scene, aspect) {
    const sceneAspect = scene.width / scene.height;
    const target = Math.sqrt(sceneAspect * aspect);
    const reverse = scene.direction === 'RL' || scene.direction === 'BT';
    if (sceneAspect > target * 1.02) {
        const w = Math.round(scene.height * target);
        return { x: reverse ? scene.width - w : 0, y: 0, w, h: scene.height };
    }
    if (sceneAspect < target / 1.02) {
        const h = Math.round(scene.width / target);
        return { x: 0, y: reverse ? scene.height - h : 0, w: scene.width, h };
    }
    return { x: 0, y: 0, w: scene.width, h: scene.height };
}

function systemTheme() {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function mountExplorer(root, options = {}) {
    const doc = root.ownerDocument;
    const win = doc.defaultView ?? globalThis;
    const storage = options.storage === undefined ? safeStorage() : options.storage;
    const features = {
        import: options.features?.import ?? true,
        export: options.features?.export ?? EXPORT_KINDS,
        storage: options.features?.storage ?? Boolean(storage)
    };
    const services = { ...(options.services ?? {}) };
    const state = {
        set: options.set,
        source: options.source ?? 'default',
        t: createDiagramTranslator(options.lang ?? options.set?.lang),
        route: parseRoute(win.location.hash),
        theme: null,
        viewer: null,
        workspace: null,
        selection: null,
        measure: null,
        inspectorOpen: win.innerWidth > 1100,
        sidebarOpen: win.innerWidth > 860,
        pendingImport: null,
        thumbObserver: null,
        fontCss: false,
        fontsReady: false,
        pendingTrail: null,
        destroyed: false
    };
    const t = (...args) => state.t(...args);
    const listeners = [];
    const on = (target, type, handler, opts) => {
        target.addEventListener(type, handler, opts);
        listeners.push(() => target.removeEventListener(type, handler, opts));
    };

    const readTheme = () => {
        try {
            return storage?.getItem(THEME_KEY) ?? null;
        } catch {
            return null;
        }
    };
    const storedTheme = readTheme();
    state.theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : systemTheme();

    root.classList.add('dx-app');
    root.innerHTML = '';
    const screen = doc.createElement('div');
    screen.className = 'dx-screen';
    const toasts = doc.createElement('div');
    toasts.className = 'dx-toasts';
    toasts.setAttribute('role', 'status');
    toasts.setAttribute('aria-live', 'polite');
    const veil = doc.createElement('div');
    veil.className = 'dx-veil';
    veil.hidden = true;
    veil.innerHTML = `<div class="dx-veil-card">${icon('upload', 28)}<strong>${escapeHtml(t('import.drop'))}</strong><span>${escapeHtml(t('import.dropHint'))}</span></div>`;
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = IMPORT_ACCEPT;
    fileInput.hidden = true;
    fileInput.className = 'dx-file';
    const dialog = doc.createElement('dialog');
    dialog.className = 'dx-dialog';
    root.append(screen, toasts, veil, fileInput, dialog);

    const applyAppTheme = () => {
        applyTheme(doc.documentElement, state.theme);
        doc.documentElement.style.colorScheme = state.theme;
        state.viewer?.setTheme(state.theme);
    };
    applyAppTheme();

    const toast = (message, { tone = 'info', action } = {}) => {
        const item = doc.createElement('div');
        item.className = `dx-toast dx-toast-${tone}`;
        const text = doc.createElement('span');
        text.textContent = message;
        item.appendChild(text);
        if (action) {
            const actionButton = doc.createElement('button');
            actionButton.type = 'button';
            actionButton.className = 'dx-toast-action';
            actionButton.textContent = action.label;
            actionButton.addEventListener('click', () => {
                action.run();
                item.remove();
            });
            item.appendChild(actionButton);
        }
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'dx-toast-close';
        close.setAttribute('aria-label', t('common.dismiss'));
        close.innerHTML = icon('x', 14);
        close.addEventListener('click', () => item.remove());
        item.appendChild(close);
        toasts.appendChild(item);
        setTimeout(() => item.remove(), tone === 'error' ? 9000 : 4500);
    };

    const service = async (name) => {
        if (services[name]) return services[name];
        try {
            services[name] = await LOADERS[name]();
            if (typeof services[name] !== 'function') throw new Error(`${name} is not a function`);
            return services[name];
        } catch (error) {
            console.error(`diagram explorer: ${name} could not be loaded`, error);
            delete services[name];
            throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        }
    };

    const measure = () => {
        if (!state.measure) state.measure = doc.fonts ? createCanvasMeasure(doc) : approximateMeasure;
        return state.measure;
    };

    const categoryOf = (diagram) => state.set.categories.find((category) => category.id === diagram.category) ?? state.set.categories[0];
    const diagramsIn = (categoryId) => state.set.diagrams.filter((diagram) => diagram.category === categoryId);

    const thumbnail = (diagram, aspect = 1.6) => {
        try {
            const scene = layoutDiagram(diagram, { measure: measure() });
            const svg = renderSvg(scene, { mode: 'export', theme: state.theme, set: state.set, background: false });
            const box = thumbnailWindow(scene, aspect);
            return svg.replace(/viewBox="[^"]*"/, `viewBox="${box.x} ${box.y} ${box.w} ${box.h}"`);
        } catch (error) {
            console.error('diagram explorer: thumbnail failed', error);
            return '';
        }
    };

    const writeStorage = (key, value) => {
        try {
            storage?.setItem(key, value);
            return true;
        } catch (error) {
            console.error('diagram explorer: storage failed', error);
            return false;
        }
    };

    const persist = () => {
        if (!features.storage || state.source !== 'local') return;
        if (!writeStorage(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), set: serializeDiagramSet(state.set) }))) {
            toast(friendlyError(t, 'storage'), { tone: 'error' });
        }
    };

    const forget = () => {
        try {
            storage?.removeItem(STORAGE_KEY);
        } catch (error) {
            console.error('diagram explorer: storage removal failed', error);
        }
        options.onForget?.();
        toast(t('storage.removed'));
    };

    const navigate = (hash) => {
        if (win.location.hash === hash) handleRoute();
        else win.location.hash = hash;
    };

    const destroyViewer = () => {
        state.viewer?.destroy();
        state.viewer = null;
        state.workspace = null;
    };

    const themeButton = () => `<button type="button" class="dx-btn dx-btn-icon" data-action="theme" aria-label="${escapeAttr(t('topbar.theme'))}" title="${escapeAttr(t('topbar.theme'))}">${icon(state.theme === 'dark' ? 'sun' : 'moon')}</button>`;
    const importButton = (variant = 'dx-btn-soft') => features.import
        ? `<button type="button" class="dx-btn ${variant}" data-action="import-menu" aria-haspopup="menu" aria-expanded="false">${icon('upload')}<span>${escapeHtml(t('topbar.import'))}</span></button>
           <div class="dx-menu" role="menu" hidden>
             <button type="button" role="menuitem" class="dx-menu-item" data-action="import-file">${icon('file')}<span>${escapeHtml(t('import.choose'))}</span></button>
             <button type="button" role="menuitem" class="dx-menu-item" data-action="import-paste">${icon('clipboard')}<span>${escapeHtml(t('import.paste'))}</span></button>
           </div>`
        : '';
    const localNotice = () => state.source === 'local' && features.storage
        ? `<div class="dx-local"><span class="dx-chip dx-chip-accent">${escapeHtml(t('storage.localBadge'))}</span><span class="dx-local-text">${escapeHtml(t('storage.saved'))}</span><button type="button" class="dx-btn dx-btn-ghost dx-btn-sm" data-action="forget">${icon('trash', 14)}<span>${escapeHtml(t('storage.remove'))}</span></button></div>`
        : '';

    const renderGallery = () => {
        destroyViewer();
        state.thumbObserver?.disconnect();
        const route = state.route;
        const category = route.view === 'category' ? state.set.categories.find((entry) => entry.id === route.category) : null;
        const list = category ? diagramsIn(category.id) : state.set.diagrams;
        const categories = state.set.categories.filter((entry) => diagramsIn(entry.id).length || !category);
        const heading = category ? category.title : state.set.title;
        const lede = category ? category.description : state.set.description;
        screen.innerHTML = `
            <a class="dx-skip" href="#dx-main">${escapeHtml(t('app.skip'))}</a>
            <div class="dx-gallery">
                <header class="dx-gallery-bar">
                    <a class="dx-brand" href="#/">${icon('layers', 18)}<span>${escapeHtml(t('app.title'))}</span></a>
                    <div class="dx-bar-actions"><div class="dx-menu-wrap">${importButton()}</div>${themeButton()}</div>
                </header>
                <main class="dx-gallery-main" id="dx-main" tabindex="-1">
                    ${category ? `<nav class="dx-crumbs dx-crumbs-page" aria-label="${escapeAttr(t('topbar.breadcrumb'))}"><ol><li><a href="#/">${escapeHtml(state.set.title)}</a></li><li aria-current="page">${escapeHtml(category.title)}</li></ol></nav>` : ''}
                    <section class="dx-hero">
                        <h1 class="dx-display">${escapeHtml(heading)}</h1>
                        ${lede ? `<p class="dx-lede">${escapeHtml(lede)}</p>` : ''}
                        ${localNotice()}
                    </section>
                    ${category ? '' : `<section class="dx-categories" aria-label="${escapeAttr(t('gallery.all'))}">
                        ${categories.map((entry) => {
                            const first = diagramsIn(entry.id)[0];
                            const count = diagramsIn(entry.id).length;
                            return `<a class="dx-cat-card" href="#/c/${encodeURIComponent(entry.id)}" data-color="${escapeAttr(entry.color)}">
                                <div class="dx-cat-thumb" aria-hidden="true">${first ? thumbnail(first, 1.75) : `<div class="dx-cat-empty">${icon(entry.icon ?? 'layers', 40)}</div>`}</div>
                                <div class="dx-cat-body">
                                    <div class="dx-cat-head">${entry.icon ? `<span class="dx-cat-icon">${icon(entry.icon, 16)}</span>` : ''}<h2 class="dx-cat-title">${escapeHtml(entry.title)}</h2><span class="dx-cat-count">${escapeHtml(t('gallery.categoryCount', { count }))}</span></div>
                                    ${entry.description ? `<p class="dx-cat-desc">${escapeHtml(entry.description)}</p>` : ''}
                                    <span class="dx-cat-link">${escapeHtml(t('gallery.explore', { name: entry.title.toLocaleLowerCase(state.set.lang || 'es') }))}${icon('chevron-right', 14)}</span>
                                </div>
                            </a>`;
                        }).join('')}
                    </section>`}
                    <section class="dx-all">
                        ${category ? '' : `<h2 class="dx-section-title">${escapeHtml(t('gallery.all'))}</h2>`}
                        ${list.length ? `<ul class="dx-bento">
                            ${list.map((diagram, index) => {
                                const cat = categoryOf(diagram);
                                const size = index === 0 && list.length > 3 ? 'dx-tile-wide' : '';
                                return `<li class="dx-bento-item ${size}">
                                    <a class="dx-tile" href="${diagramHref(diagram.id)}">
                                        <div class="dx-tile-thumb" data-thumb="${escapeAttr(diagram.id)}" data-aspect="${size ? 2.6 : 1.3}" aria-hidden="true"></div>
                                        <div class="dx-tile-meta">
                                            <span class="dx-tile-title">${escapeHtml(diagram.title)}</span>
                                            <span class="dx-tile-info"><span class="dx-chip" data-color="${escapeAttr(cat?.color ?? 'neutral')}">${escapeHtml(cat?.title ?? '')}</span><span class="dx-count">${escapeHtml(countLabel(t, diagram))}</span></span>
                                        </div>
                                    </a>
                                </li>`;
                            }).join('')}
                        </ul>` : `<p class="dx-empty">${escapeHtml(t('gallery.emptyCategory'))}</p>`}
                        ${features.import ? `<p class="dx-hint">${icon('mouse-pointer-click', 14)}<span>${escapeHtml(t('gallery.importHint'))}</span></p>` : ''}
                    </section>
                </main>
            </div>`;
        const fill = (element) => {
            if (element.dataset.filled) return;
            const diagram = findDiagram(state.set, element.dataset.thumb);
            if (!diagram) return;
            element.innerHTML = thumbnail(diagram, Number(element.dataset.aspect) || 1.3);
            element.dataset.filled = 'true';
        };
        const thumbs = [...screen.querySelectorAll('[data-thumb]')];
        if (typeof IntersectionObserver === 'function') {
            state.thumbObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    fill(entry.target);
                    state.thumbObserver.unobserve(entry.target);
                }
            }, { rootMargin: '200px' });
            thumbs.forEach((element) => state.thumbObserver.observe(element));
        } else {
            thumbs.forEach(fill);
        }
        doc.title = `${heading} · ${t('app.title')}`;
    };

    const sidebarMarkup = (activeId) => {
        const query = state.workspace?.query ?? '';
        const needle = query.trim().toLowerCase();
        const groups = state.set.categories.map((category) => {
            const items = diagramsIn(category.id).filter((diagram) => !needle || `${diagram.title} ${diagram.description ?? ''}`.toLowerCase().includes(needle));
            if (!items.length) return '';
            return `<div class="dx-list-group" data-color="${escapeAttr(category.color)}">
                <h3 class="dx-list-heading"><span class="dx-swatch" aria-hidden="true"></span>${escapeHtml(category.title)}</h3>
                <ul>${items.map((diagram) => `<li><a class="dx-list-item" href="${diagramHref(diagram.id)}"${diagram.id === activeId ? ' aria-current="page"' : ''}>
                    <span class="dx-list-icon" aria-hidden="true">${icon(diagram.kind === 'sequence' ? 'arrow-left-right' : (diagram.lanes.length ? 'layout-grid' : 'workflow'), 15)}</span>
                    <span class="dx-list-title">${escapeHtml(diagram.title)}</span>
                </a></li>`).join('')}</ul>
            </div>`;
        }).join('');
        return groups || `<p class="dx-empty dx-empty-sm">${escapeHtml(t('sidebar.noResults'))}</p>`;
    };

    const exportMenu = () => {
        const kinds = new Set(features.export);
        const item = (action, iconName, label, extra = '') => `<button type="button" role="menuitem" class="dx-menu-item" data-action="${action}" ${extra}>${icon(iconName)}<span>${escapeHtml(label)}</span></button>`;
        const image = [
            kinds.has('svg') ? item('export', 'pen-tool', t('export.svg'), 'data-kind="svg"') : '',
            ...(kinds.has('png') ? [1, 2, 3].map((scale) => item('export', 'image', t('export.png', { scale }), `data-kind="png" data-scale="${scale}"`)) : []),
            kinds.has('jpg') ? item('export', 'file-image', t('export.jpg'), 'data-kind="jpg"') : ''
        ].join('');
        const documents = [
            kinds.has('pdf') ? item('export', 'file-text', t('export.pdf'), 'data-kind="pdf"') : '',
            kinds.has('pdf') ? item('export', 'book-open', t('export.pdfAll'), 'data-kind="pdf-all"') : '',
            kinds.has('html') ? item('export', 'file-code', t('export.html'), 'data-kind="html"') : ''
        ].join('');
        const data = kinds.has('json') ? item('export', 'file-json', t('export.json'), 'data-kind="json"') : '';
        const section = (title, body) => (body ? `<div class="dx-menu-section"><p class="dx-menu-label">${escapeHtml(title)}</p>${body}</div>` : '');
        return section(t('export.image'), image) + section(t('export.document'), documents) + section(t('export.data'), data);
    };

    const renderWorkspace = () => {
        state.thumbObserver?.disconnect();
        screen.innerHTML = `
            <a class="dx-skip" href="#dx-canvas">${escapeHtml(t('app.skip'))}</a>
            <div class="dx-workspace" data-sidebar="${state.sidebarOpen ? 'open' : 'closed'}" data-inspector="${state.inspectorOpen ? 'open' : 'closed'}">
                <header class="dx-topbar">
                    <button type="button" class="dx-btn dx-btn-icon dx-only-narrow" data-action="sidebar" aria-label="${escapeAttr(t('topbar.toggleSidebar'))}" aria-expanded="${state.sidebarOpen}">${icon('panel-left')}</button>
                    <a class="dx-home" href="#/" aria-label="${escapeAttr(t('topbar.home'))}" title="${escapeAttr(t('topbar.home'))}">${icon('layers', 18)}</a>
                    <nav class="dx-crumbs" aria-label="${escapeAttr(t('topbar.breadcrumb'))}"><ol></ol></nav>
                    <div class="dx-actions">
                        <button type="button" class="dx-btn dx-btn-ghost" data-action="steps">${icon('play')}<span class="dx-label">${escapeHtml(t('topbar.steps'))}</span></button>
                        ${features.export.length ? `<div class="dx-menu-wrap"><button type="button" class="dx-btn dx-btn-ghost" data-action="export-menu" aria-haspopup="menu" aria-expanded="false">${icon('download')}<span class="dx-label">${escapeHtml(t('topbar.export'))}</span></button><div class="dx-menu dx-menu-end" role="menu" hidden>${exportMenu()}</div></div>` : ''}
                        <button type="button" class="dx-btn dx-btn-icon" data-action="fullscreen" aria-label="${escapeAttr(t('topbar.fullscreen'))}" title="${escapeAttr(t('topbar.fullscreen'))}">${icon('maximize')}</button>
                        ${themeButton()}
                        <button type="button" class="dx-btn dx-btn-icon" data-action="inspector" aria-label="${escapeAttr(t('topbar.toggleInspector'))}" title="${escapeAttr(t('topbar.toggleInspector'))}" aria-expanded="${state.inspectorOpen}">${icon('panel-right')}</button>
                    </div>
                </header>
                <aside class="dx-sidebar" aria-label="${escapeAttr(t('sidebar.label'))}">
                    <label class="dx-search">${icon('search', 15)}<input type="search" data-input="sidebar-search" placeholder="${escapeAttr(t('sidebar.search'))}" aria-label="${escapeAttr(t('sidebar.search'))}" autocomplete="off"></label>
                    <nav class="dx-list"></nav>
                    <div class="dx-sidebar-foot">${localNotice()}${features.import ? `<div class="dx-menu-wrap dx-menu-up">${importButton('dx-btn-soft dx-btn-block')}</div>` : ''}</div>
                </aside>
                <main class="dx-canvas" id="dx-canvas" tabindex="-1"><div class="dx-viewer-host"></div></main>
                <aside class="dx-inspector" aria-label="${escapeAttr(t('inspector.label'))}"><div class="dx-inspector-body"></div></aside>
                <div class="dx-scrim" data-action="close-panels" aria-hidden="true"></div>
            </div>`;
        const host = screen.querySelector('.dx-viewer-host');
        state.workspace = { query: '', find: '' };
        state.viewer = mountDiagram(host, {
            set: state.set,
            diagramId: state.route.diagram,
            node: state.route.node,
            theme: state.theme,
            lang: state.set.lang,
            onNavigate: ({ diagram, node, back }) => {
                state.pendingTrail = back ? 'back' : 'push';
                navigate(diagramHref(diagram, node));
            },
            onSelect: (selection) => {
                state.selection = selection;
                renderInspector();
            },
            onRender: () => renderInspector(),
            onStep: () => renderInspector()
        });
        state.viewer.ready.then(() => {
            if (!state.destroyed) doc.documentElement.dataset.capidocs = 'ready';
        });
    };

    const updateWorkspaceChrome = () => {
        const diagram = state.viewer?.diagram;
        if (!diagram) return;
        const category = categoryOf(diagram);
        const crumbs = screen.querySelector('.dx-crumbs ol');
        crumbs.innerHTML = `<li class="dx-hide-narrow"><a href="#/">${escapeHtml(state.set.title)}</a></li>${category ? `<li class="dx-hide-narrow"><a href="#/c/${encodeURIComponent(category.id)}">${escapeHtml(category.title)}</a></li>` : ''}<li aria-current="page"><span>${escapeHtml(diagram.title)}</span></li>`;
        screen.querySelector('.dx-list').innerHTML = sidebarMarkup(diagram.id);
        const steps = screen.querySelector('[data-action="steps"]');
        steps.disabled = !diagram.steps.length;
        steps.setAttribute('aria-pressed', String(state.viewer.step >= 0));
        doc.title = `${diagram.title} · ${state.set.title}`;
    };

    const legendMarkup = (diagram) => {
        const parts = [];
        if (diagram.kind === 'graph' && diagram.groups.length) {
            parts.push(`<div class="dx-legend-block"><p class="dx-legend-title">${escapeHtml(t('inspector.groupsLegend'))}</p><ul class="dx-legend">${diagram.groups.map((group) => `<li><span class="dx-swatch" data-color="${escapeAttr(group.color)}" aria-hidden="true"></span><button type="button" class="dx-link-btn" data-action="select" data-type="group" data-id="${escapeAttr(group.id)}">${escapeHtml(group.title)}</button></li>`).join('')}</ul></div>`);
        }
        if (diagram.kind === 'graph' && diagram.lanes.length) {
            parts.push(`<div class="dx-legend-block"><p class="dx-legend-title">${escapeHtml(t('inspector.lanesLegend'))}</p><ul class="dx-legend">${diagram.lanes.map((lane) => `<li><span class="dx-swatch" data-color="${escapeAttr(lane.color)}" aria-hidden="true"></span><span>${escapeHtml(lane.title)}</span></li>`).join('')}</ul></div>`);
        }
        if (diagram.kind === 'graph') {
            const styles = [...new Set(diagram.edges.map((edge) => edge.style))];
            if (styles.length > 1 || (styles.length === 1 && styles[0] !== 'solid')) {
                parts.push(`<div class="dx-legend-block"><p class="dx-legend-title">${escapeHtml(t('inspector.linesLegend'))}</p><ul class="dx-legend">${styles.map((style) => `<li><svg class="dx-line-sample" width="28" height="8" aria-hidden="true"><line x1="1" x2="27" y1="4" y2="4" class="dx-line-${style}"/></svg><span>${escapeHtml(t(`inspector.line.${style}`))}</span></li>`).join('')}</ul></div>`);
            }
        } else {
            const styles = new Set();
            const walk = (items) => items.forEach((item) => {
                if (item.type === 'message') styles.add(item.style);
                if (item.type === 'block') { walk(item.items); item.branches.forEach((branch) => walk(branch.items)); }
            });
            walk(diagram.items);
            parts.push(`<div class="dx-legend-block"><p class="dx-legend-title">${escapeHtml(t('inspector.messagesLegend'))}</p><ul class="dx-legend">${[...styles].map((style) => `<li><svg class="dx-line-sample" width="28" height="8" aria-hidden="true"><line x1="1" x2="27" y1="4" y2="4" class="dx-line-${style === 'reply' ? 'dashed' : 'solid'}"/></svg><span>${escapeHtml(t(`inspector.message.${style}`))}</span></li>`).join('')}</ul></div>`);
        }
        return parts.length ? `<section class="dx-section"><h3 class="dx-section-label">${escapeHtml(t('inspector.legend'))}</h3>${parts.join('')}</section>` : '';
    };

    const tagsOf = (diagram) => {
        const tags = new Set(diagram.tags ?? []);
        for (const node of diagram.nodes) for (const tag of node.tags) tags.add(tag);
        return [...tags].sort((a, b) => a.localeCompare(b));
    };

    const diagramOverview = (diagram) => {
        const scene = state.viewer.scene;
        const category = categoryOf(diagram);
        const filter = state.viewer.filter;
        const tags = tagsOf(diagram);
        const connections = diagram.kind === 'sequence' ? scene.messages.length : diagram.edges.length;
        const steps = diagram.steps;
        const find = state.workspace.find ?? '';
        const results = find ? state.viewer.search(find).slice(0, 8) : [];
        return `
            <header class="dx-inspector-head">
                ${category ? `<span class="dx-chip" data-color="${escapeAttr(category.color)}">${escapeHtml(category.title)}</span>` : ''}
                <h2 class="dx-inspector-title">${escapeHtml(diagram.title)}</h2>
                <p class="dx-meta">${escapeHtml(countLabel(t, diagram))} · ${escapeHtml(t('inspector.connections', { count: connections }))}</p>
            </header>
            ${diagram.description ? `<section class="dx-section"><h3 class="dx-section-label">${escapeHtml(t('inspector.about'))}</h3><p class="dx-prose">${escapeHtml(diagram.description)}</p></section>` : ''}
            <section class="dx-section">
                <h3 class="dx-section-label"><label for="dx-find">${escapeHtml(t('inspector.findNode'))}</label></h3>
                <div class="dx-search dx-search-inline">${icon('search', 15)}<input id="dx-find" type="search" data-input="find" value="${escapeAttr(find)}" placeholder="${escapeAttr(t('inspector.findPlaceholder'))}" autocomplete="off"></div>
                ${find ? (results.length ? `<ul class="dx-results">${results.map((result) => `<li><button type="button" class="dx-row-btn" data-action="reveal" data-id="${escapeAttr(result.id)}">${icon(result.group ? 'layers' : 'locate', 14)}<span>${escapeHtml(result.title)}</span></button></li>`).join('')}</ul>` : `<p class="dx-muted dx-small">${escapeHtml(t('inspector.noMatches'))}</p>`) : ''}
            </section>
            ${tags.length ? `<section class="dx-section"><div class="dx-section-row"><h3 class="dx-section-label">${escapeHtml(t('inspector.filters'))}</h3>${filter.tags.size ? `<button type="button" class="dx-link-btn dx-small" data-action="clear-filters">${escapeHtml(t('inspector.clearFilters'))}</button>` : ''}</div><div class="dx-tags">${tags.map((tag) => `<button type="button" class="dx-tag" data-action="toggle-tag" data-tag="${escapeAttr(tag)}" aria-pressed="${filter.tags.has(tag)}">${escapeHtml(tag)}</button>`).join('')}</div></section>` : ''}
            ${legendMarkup(diagram)}
            ${steps.length ? `<section class="dx-section"><div class="dx-section-row"><h3 class="dx-section-label">${escapeHtml(t('inspector.steps'))}</h3><button type="button" class="dx-btn dx-btn-soft dx-btn-sm" data-action="play-steps">${icon('play', 14)}<span>${escapeHtml(t('inspector.playSteps'))}</span></button></div><ol class="dx-steps">${steps.map((step, index) => `<li><button type="button" class="dx-step" data-action="go-step" data-index="${index}"${state.viewer.step === index ? ' aria-current="step"' : ''}><span class="dx-step-num">${index + 1}</span><span class="dx-step-text"><strong>${escapeHtml(step.title)}</strong>${step.description ? `<span>${escapeHtml(step.description)}</span>` : ''}</span></button></li>`).join('')}</ol></section>` : ''}`;
    };

    const nodeTitle = (diagram, id) => {
        if (diagram.kind === 'sequence') return diagram.participants.find((participant) => participant.id === id)?.title ?? id;
        return diagram.nodes.find((node) => node.id === id)?.title ?? diagram.groups.find((group) => group.id === id)?.title ?? id;
    };

    const connectionList = (diagram, entries, end) => entries.length
        ? `<ul class="dx-connections">${entries.map((edge) => {
            const other = end === 'in' ? edge.from : edge.to;
            return `<li><button type="button" class="dx-row-btn" data-action="select" data-type="node" data-id="${escapeAttr(other)}">${icon(end === 'in' ? 'arrow-right' : 'arrow-up-right', 14)}<span class="dx-row-title">${escapeHtml(nodeTitle(diagram, other))}</span>${edge.label ? `<span class="dx-row-note">${escapeHtml(edge.label)}</span>` : ''}</button></li>`;
        }).join('')}</ul>`
        : `<p class="dx-muted dx-small">${escapeHtml(t('inspector.noConnections'))}</p>`;

    const nodeDetail = (diagram, id) => {
        const scene = state.viewer.scene;
        const isSequence = diagram.kind === 'sequence';
        const source = isSequence ? diagram.participants.find((participant) => participant.id === id) : diagram.nodes.find((node) => node.id === id);
        if (!source) return null;
        const edges = isSequence
            ? scene.messages.map((message) => ({ id: message.id, from: message.from, to: message.to, label: message.label }))
            : scene.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, label: edge.label }));
        const incoming = edges.filter((edge) => edge.to === id && edge.from !== id);
        const outgoing = edges.filter((edge) => edge.from === id && edge.to !== id);
        const kind = isSequence ? t('shape.participant') : t(`shape.${source.shape}`);
        const badge = source.badge?.text;
        const group = !isSequence && source.group ? diagram.groups.find((entry) => entry.id === source.group) : null;
        const lane = !isSequence && source.lane ? diagram.lanes.find((entry) => entry.id === source.lane) : null;
        const link = source.link;
        const expandable = Boolean(source.props?.length || source.preview?.values?.length);
        return `
            <header class="dx-inspector-head">
                <div class="dx-inspector-top"><span class="dx-chip">${escapeHtml(kind)}</span>${badge ? `<span class="dx-chip" data-color="${escapeAttr(source.badge.color ?? 'neutral')}">${escapeHtml(badge)}</span>` : ''}<button type="button" class="dx-btn dx-btn-icon dx-btn-sm dx-push" data-action="clear-selection" aria-label="${escapeAttr(t('inspector.clearSelection'))}" title="${escapeAttr(t('inspector.clearSelection'))}">${icon('x', 14)}</button></div>
                <h2 class="dx-inspector-title">${source.icon ? `<span class="dx-title-icon" data-color="${escapeAttr(source.color ?? 'neutral')}">${icon(source.icon, 16)}</span>` : ''}<span>${escapeHtml(source.title)}</span></h2>
                ${source.subtitle ? `<p class="dx-mono">${escapeHtml(source.subtitle)}</p>` : ''}
            </header>
            ${link ? `<div class="dx-section dx-actions-row">${link.diagram ? `<button type="button" class="dx-btn dx-btn-strong" data-action="open-detail" data-id="${escapeAttr(id)}">${icon('arrow-up-right', 15)}<span>${escapeHtml(link.label ?? t('inspector.openDetail'))}</span></button>` : ''}${link.href ? `<a class="dx-btn dx-btn-soft" href="${escapeAttr(link.href)}" target="_blank" rel="noopener noreferrer">${icon('external-link', 15)}<span>${escapeHtml(link.diagram ? t('inspector.openLink') : (link.label ?? t('inspector.openLink')))}</span></a>` : ''}</div>` : ''}
            ${source.description ? `<section class="dx-section"><p class="dx-prose">${escapeHtml(source.description)}</p></section>` : ''}
            ${source.props?.length ? `<section class="dx-section"><div class="dx-section-row"><h3 class="dx-section-label">${escapeHtml(t('inspector.props'))}</h3>${expandable ? `<button type="button" class="dx-link-btn dx-small" data-action="toggle-expand" data-id="${escapeAttr(id)}">${escapeHtml(state.viewer.isExpanded(id) ? t('viewer.collapse') : t('viewer.expand'))}</button>` : ''}</div><dl class="dx-props">${source.props.map((prop) => `<div><dt>${escapeHtml(prop.label)}</dt><dd class="${prop.mono ? 'dx-mono' : ''}"${prop.status ? ` data-status="${escapeAttr(prop.status)}"` : ''}>${escapeHtml(prop.value)}</dd></div>`).join('')}</dl></section>` : ''}
            ${source.fields?.length ? `<section class="dx-section"><h3 class="dx-section-label">${escapeHtml(t('inspector.fields'))}</h3><dl class="dx-props dx-fields">${source.fields.map((field) => `<div><dt class="dx-mono">${field.key ? `<span class="dx-key">${escapeHtml(field.key)}</span>` : ''}${escapeHtml(field.name)}</dt><dd class="dx-mono dx-muted">${escapeHtml(field.type ?? '')}</dd></div>`).join('')}</dl></section>` : ''}
            ${group || lane || source.tags?.length ? `<section class="dx-section"><dl class="dx-props">${group ? `<div><dt>${escapeHtml(t('inspector.group'))}</dt><dd><button type="button" class="dx-link-btn" data-action="select" data-type="group" data-id="${escapeAttr(group.id)}">${escapeHtml(group.title)}</button></dd></div>` : ''}${lane ? `<div><dt>${escapeHtml(t('inspector.lane'))}</dt><dd>${escapeHtml(lane.title)}</dd></div>` : ''}${source.tags?.length ? `<div><dt>${escapeHtml(t('inspector.tags'))}</dt><dd class="dx-tags">${source.tags.map((tag) => `<span class="dx-chip">${escapeHtml(tag)}</span>`).join('')}</dd></div>` : ''}</dl></section>` : ''}
            <section class="dx-section"><h3 class="dx-section-label">${escapeHtml(t('inspector.incoming'))}</h3>${connectionList(diagram, incoming, 'in')}</section>
            <section class="dx-section"><h3 class="dx-section-label">${escapeHtml(t('inspector.outgoing'))}</h3>${connectionList(diagram, outgoing, 'out')}</section>`;
    };

    const groupDetail = (diagram, id) => {
        const group = diagram.groups.find((entry) => entry.id === id);
        if (!group) return null;
        const members = diagram.nodes.filter((node) => node.group === id);
        const children = diagram.groups.filter((entry) => entry.parent === id);
        return `
            <header class="dx-inspector-head">
                <div class="dx-inspector-top"><span class="dx-chip" data-color="${escapeAttr(group.color)}">${escapeHtml(t('shape.group'))}</span><button type="button" class="dx-btn dx-btn-icon dx-btn-sm dx-push" data-action="clear-selection" aria-label="${escapeAttr(t('inspector.clearSelection'))}">${icon('x', 14)}</button></div>
                <h2 class="dx-inspector-title">${group.icon ? `<span class="dx-title-icon" data-color="${escapeAttr(group.color)}">${icon(group.icon, 16)}</span>` : ''}<span>${escapeHtml(group.title)}</span></h2>
                <p class="dx-meta">${escapeHtml(t('inspector.members', { count: members.length + children.length }))}</p>
            </header>
            ${group.link?.diagram ? `<div class="dx-section dx-actions-row"><button type="button" class="dx-btn dx-btn-strong" data-action="open-detail" data-id="${escapeAttr(id)}">${icon('arrow-up-right', 15)}<span>${escapeHtml(group.link.label ?? t('inspector.openDetail'))}</span></button></div>` : ''}
            ${group.description ? `<section class="dx-section"><p class="dx-prose">${escapeHtml(group.description)}</p></section>` : ''}
            <section class="dx-section"><ul class="dx-connections">${[...children.map((child) => ({ id: child.id, title: child.title, type: 'group', icon: 'layers' })), ...members.map((node) => ({ id: node.id, title: node.title, type: 'node', icon: node.icon && BUILTIN_ICONS[node.icon] ? node.icon : 'box' }))].map((entry) => `<li><button type="button" class="dx-row-btn" data-action="select" data-type="${entry.type}" data-id="${escapeAttr(entry.id)}">${icon(entry.icon, 14)}<span class="dx-row-title">${escapeHtml(entry.title)}</span></button></li>`).join('')}</ul></section>
            <section class="dx-section"><button type="button" class="dx-btn dx-btn-soft dx-btn-sm" data-action="toggle-group" data-id="${escapeAttr(id)}">${icon(state.viewer.isCollapsed(id) ? 'chevron-down' : 'chevron-up', 14)}<span>${escapeHtml(t('viewer.groupToggle', { title: group.title }))}</span></button></section>`;
    };

    const edgeDetail = (diagram, id, type) => {
        const scene = state.viewer.scene;
        const entry = type === 'message'
            ? scene.messages.find((message) => message.id === id)
            : scene.edges.find((edge) => edge.id === id);
        if (!entry) return null;
        const source = entry.source;
        return `
            <header class="dx-inspector-head">
                <div class="dx-inspector-top"><span class="dx-chip">${escapeHtml(t(type === 'message' ? 'inspector.message' : 'inspector.connection'))}</span><button type="button" class="dx-btn dx-btn-icon dx-btn-sm dx-push" data-action="clear-selection" aria-label="${escapeAttr(t('inspector.clearSelection'))}">${icon('x', 14)}</button></div>
                <h2 class="dx-inspector-title"><span>${escapeHtml(source.label ?? `${nodeTitle(diagram, entry.from)} → ${nodeTitle(diagram, entry.to)}`)}</span></h2>
            </header>
            <section class="dx-section"><dl class="dx-props">
                <div><dt>${escapeHtml(t('inspector.from'))}</dt><dd><button type="button" class="dx-link-btn" data-action="select" data-type="node" data-id="${escapeAttr(entry.from)}">${escapeHtml(nodeTitle(diagram, entry.from))}</button></dd></div>
                <div><dt>${escapeHtml(t('inspector.to'))}</dt><dd><button type="button" class="dx-link-btn" data-action="select" data-type="node" data-id="${escapeAttr(entry.to)}">${escapeHtml(nodeTitle(diagram, entry.to))}</button></dd></div>
            </dl></section>
            ${source.description ? `<section class="dx-section"><p class="dx-prose">${escapeHtml(source.description)}</p></section>` : ''}`;
    };

    const renderInspector = () => {
        const body = screen.querySelector('.dx-inspector-body');
        if (!body || !state.viewer?.diagram) return;
        updateWorkspaceChrome();
        const diagram = state.viewer.diagram;
        const selection = state.selection?.diagram === diagram.id ? state.selection : null;
        let markup = null;
        if (selection?.type === 'node') markup = nodeDetail(diagram, selection.id);
        else if (selection?.type === 'group') markup = groupDetail(diagram, selection.id);
        else if (selection?.type === 'edge' || selection?.type === 'message') markup = edgeDetail(diagram, selection.id, selection.type);
        const focused = doc.activeElement?.dataset?.input === 'find';
        body.innerHTML = markup ?? diagramOverview(diagram);
        if (focused) {
            const input = body.querySelector('[data-input="find"]');
            input?.focus();
            input?.setSelectionRange?.(input.value.length, input.value.length);
        }
    };

    const setPanels = () => {
        const workspace = screen.querySelector('.dx-workspace');
        if (!workspace) return;
        workspace.dataset.sidebar = state.sidebarOpen ? 'open' : 'closed';
        workspace.dataset.inspector = state.inspectorOpen ? 'open' : 'closed';
        screen.querySelector('[data-action="sidebar"]')?.setAttribute('aria-expanded', String(state.sidebarOpen));
        screen.querySelector('[data-action="inspector"]')?.setAttribute('aria-expanded', String(state.inspectorOpen));
    };

    const handleRoute = () => {
        state.route = parseRoute(win.location.hash);
        if (state.route.view === 'diagram') {
            const diagram = findDiagram(state.set, state.route.diagram);
            if (!diagram) {
                toast(friendlyError(t, 'not_found'), { tone: 'error' });
                navigate('#/');
                return;
            }
            if (!state.viewer) renderWorkspace();
            const mode = state.pendingTrail;
            state.pendingTrail = null;
            if (state.viewer.diagram?.id !== diagram.id || state.route.node) {
                state.viewer.setDiagram(diagram.id, { node: state.route.node, push: Boolean(mode), reset: !mode });
            }
            if (win.innerWidth <= 860 && state.sidebarOpen) {
                state.sidebarOpen = false;
                setPanels();
            }
            renderInspector();
            return;
        }
        renderGallery();
        if (state.fontsReady) {
            doc.documentElement.dataset.capidocs = 'ready';
            return;
        }
        ensureFonts(doc).then(() => {
            if (state.destroyed) return;
            state.fontsReady = true;
            state.measure = doc.fonts ? createCanvasMeasure(doc) : approximateMeasure;
            if (!state.viewer) renderGallery();
            doc.documentElement.dataset.capidocs = 'ready';
        });
    };

    const closeMenus = (except) => {
        for (const menu of screen.querySelectorAll('.dx-menu:not([hidden])')) {
            if (menu === except) continue;
            menu.hidden = true;
            menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
        }
    };

    const toggleMenu = (trigger) => {
        const menu = trigger.nextElementSibling;
        const opening = menu.hidden;
        closeMenus(menu);
        menu.hidden = !opening;
        trigger.setAttribute('aria-expanded', String(opening));
        if (opening) menu.querySelector('[role="menuitem"]')?.focus();
    };

    const fontCss = async () => {
        if (services.fontCss && !state.fontCss) {
            state.fontCss = true;
            setExportFontCss(await services.fontCss());
        }
        return loadExportFonts({ doc });
    };

    const exportScene = (diagram) => (diagram.id === state.viewer?.diagram?.id ? state.viewer.scene : layoutDiagram(diagram, { measure: measure() }));

    const runExport = async (kind, scale) => {
        const diagram = state.viewer?.diagram;
        if (!diagram) return;
        toast(t('export.working'));
        try {
            const download = await service('downloadBlob');
            const name = slug(diagram.id);
            if (kind === 'json') {
                const json = JSON.stringify(serializeDiagramSet(state.set), null, 2);
                await download(new Blob([json], { type: 'application/json' }), `${slug(state.set.title)}.json`);
            } else if (kind === 'html') {
                const build = await service('buildStandaloneHtml');
                const base = new URL('../../../', import.meta.url);
                const html = await build({
                    set: state.set,
                    title: state.set.title,
                    lang: state.set.lang,
                    entry: STANDALONE_ENTRY,
                    readText: async (path) => {
                        const response = await fetch(new URL(path, base));
                        if (!response.ok) throw Object.assign(new Error(`read ${path}`), { code: 'export_failed' });
                        return response.text();
                    },
                    readBinary: async (path) => {
                        const response = await fetch(new URL(path, base));
                        if (!response.ok) throw Object.assign(new Error(`read ${path}`), { code: 'export_failed' });
                        return new Uint8Array(await response.arrayBuffer());
                    }
                });
                await download(new Blob([html], { type: 'text/html' }), `${slug(state.set.title)}.html`);
            } else if (kind === 'pdf' || kind === 'pdf-all') {
                const [raster, buildPdf] = await Promise.all([service('svgToRaster'), service('buildPdf')]);
                const embed = await fontCss();
                const tokens = themeTokens('light');
                const targets = kind === 'pdf' ? [diagram] : state.set.diagrams;
                const pages = [];
                for (const entry of targets) {
                    const scene = exportScene(entry);
                    const svg = renderSvg(scene, { mode: 'export', theme: 'light', set: state.set, diagram: entry, embedFontCss: embed, title: entry.title });
                    const blob = await raster(svg, { width: scene.width, height: scene.height, scale: 2, type: 'image/jpeg', background: tokens.canvas, quality: 0.92 });
                    pages.push({
                        width: scene.width,
                        height: scene.height,
                        jpeg: new Uint8Array(await blob.arrayBuffer()),
                        imageWidth: Math.round(scene.width * 2),
                        imageHeight: Math.round(scene.height * 2),
                        texts: sceneTexts(scene, { measure: measure() })
                    });
                }
                const bytes = buildPdf(pages, { title: kind === 'pdf' ? diagram.title : state.set.title });
                await download(new Blob([bytes], { type: 'application/pdf' }), `${kind === 'pdf' ? name : slug(state.set.title)}.pdf`);
            } else {
                const embed = await fontCss();
                const svg = state.viewer.toSvg({ theme: state.theme, embedFontCss: embed });
                if (kind === 'svg') {
                    await download(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
                } else {
                    const raster = await service('svgToRaster');
                    const scene = state.viewer.scene;
                    const type = kind === 'jpg' ? 'image/jpeg' : 'image/png';
                    const blob = await raster(svg, { width: scene.width, height: scene.height, scale: Number(scale) || 2, type, background: themeTokens(state.theme).canvas, quality: 0.92 });
                    await download(blob, `${name}${kind === 'png' ? `@${Number(scale) || 2}x` : ''}.${kind === 'jpg' ? 'jpg' : 'png'}`);
                }
            }
            toast(t('export.done'));
        } catch (error) {
            console.error('diagram explorer: export failed', error);
            toast(friendlyError(t, error?.code === 'unavailable' ? 'unavailable' : 'export_failed'), { tone: 'error' });
        }
    };

    const applyIncoming = (incoming, mode) => {
        let next = incoming;
        if (mode === 'merge') {
            const merged = mergeDiagramSets(state.set, incoming);
            if (!merged.ok) {
                console.error('diagram explorer: merge failed', merged.issues);
                toast(friendlyError(t, 'invalid_model'), { tone: 'error' });
                return;
            }
            next = merged.set;
        }
        const firstNew = mode === 'merge' ? next.diagrams[state.set.diagrams.length]?.id : next.start ?? next.diagrams[0]?.id;
        setSet(next, 'local');
        persist();
        toast(t('import.done', { count: incoming.diagrams.length }));
        navigate(firstNew ? diagramHref(firstNew) : '#/');
    };

    const showDialog = (markup, onAction) => {
        dialog.innerHTML = markup;
        dialog.onclick = (event) => {
            if (event.target === dialog) {
                closeDialog();
                return;
            }
            const action = event.target.closest('[data-dialog]')?.dataset.dialog;
            if (action) onAction(action);
        };
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
        dialog.querySelector('[autofocus], textarea, button')?.focus();
    };

    const closeDialog = () => {
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        else dialog.removeAttribute('open');
        dialog.innerHTML = '';
        state.pendingImport = null;
    };
    on(dialog, 'cancel', () => {
        state.pendingImport = null;
    });

    const confirmImport = (result) => {
        state.pendingImport = result.set;
        const warnings = result.warnings?.length ?? 0;
        showDialog(`
            <form method="dialog" class="dx-dialog-body">
                <header class="dx-dialog-head"><span class="dx-dialog-icon">${icon('check-circle', 18)}</span><h2>${escapeHtml(t('import.title'))}</h2></header>
                <p>${escapeHtml(t('import.ready', { count: result.set.diagrams.length }))}</p>
                <ul class="dx-import-list">${result.set.diagrams.slice(0, 6).map((diagram) => `<li>${icon(diagram.kind === 'sequence' ? 'arrow-left-right' : 'workflow', 14)}<span>${escapeHtml(diagram.title)}</span></li>`).join('')}</ul>
                ${warnings ? `<p class="dx-warning">${icon('alert-triangle', 14)}<span>${escapeHtml(t('import.warnings', { count: warnings }))}</span></p>` : ''}
                <footer class="dx-dialog-foot">
                    <button type="button" class="dx-btn dx-btn-ghost" data-dialog="cancel">${escapeHtml(t('import.cancel'))}</button>
                    <button type="button" class="dx-btn dx-btn-soft" data-dialog="replace">${escapeHtml(t('import.replace'))}</button>
                    <button type="button" class="dx-btn dx-btn-strong" data-dialog="merge" autofocus>${escapeHtml(t('import.merge'))}</button>
                </footer>
            </form>`, (action) => {
            const incoming = state.pendingImport;
            closeDialog();
            if (!incoming || action === 'cancel') return;
            applyIncoming(incoming, action === 'replace' ? 'replace' : 'merge');
        });
    };

    const importText = async (name, text) => {
        if (!features.import) return;
        if (!text || !text.trim()) {
            toast(friendlyError(t, 'empty'), { tone: 'error' });
            return;
        }
        if (text.length > LIMITS.fileBytes) {
            toast(friendlyError(t, 'too_large'), { tone: 'error' });
            return;
        }
        try {
            const importDiagramFile = await service('importDiagramFile');
            const result = await importDiagramFile({ name, text });
            if (!result?.ok) {
                if (result?.issues?.length) console.error('diagram explorer: import issues', result.issues);
                toast(friendlyError(t, result?.error?.code ?? 'parse_error'), { tone: 'error' });
                return;
            }
            confirmImport(result);
        } catch (error) {
            console.error('diagram explorer: import failed', error);
            toast(friendlyError(t, error?.code ?? 'parse_error'), { tone: 'error' });
        }
    };

    const importFile = async (file) => {
        if (!file) return;
        if (file.size > LIMITS.fileBytes) {
            toast(friendlyError(t, 'too_large'), { tone: 'error' });
            return;
        }
        if (file.size === 0) {
            toast(friendlyError(t, 'empty'), { tone: 'error' });
            return;
        }
        let text;
        try {
            text = await file.text();
        } catch (error) {
            console.error('diagram explorer: file could not be read', error);
            toast(friendlyError(t, 'parse_error'), { tone: 'error' });
            return;
        }
        await importText(file.name, text);
    };

    const openPaste = (prefill = '') => {
        showDialog(`
            <form method="dialog" class="dx-dialog-body">
                <header class="dx-dialog-head"><span class="dx-dialog-icon">${icon('clipboard', 18)}</span><h2>${escapeHtml(t('import.paste'))}</h2></header>
                <label class="dx-field"><span>${escapeHtml(t('import.pasteLabel'))}</span><textarea rows="10" spellcheck="false" placeholder="${escapeAttr(t('import.pastePlaceholder'))}">${escapeHtml(prefill)}</textarea></label>
                <footer class="dx-dialog-foot">
                    <button type="button" class="dx-btn dx-btn-ghost" data-dialog="cancel">${escapeHtml(t('import.cancel'))}</button>
                    <button type="button" class="dx-btn dx-btn-strong" data-dialog="read">${escapeHtml(t('import.read'))}</button>
                </footer>
            </form>`, (action) => {
            const text = dialog.querySelector('textarea')?.value ?? '';
            closeDialog();
            if (action === 'read') importText(guessName(text), text);
        });
    };

    const setSet = (next, source) => {
        destroyViewer();
        state.set = next;
        state.source = source;
        state.selection = null;
        state.t = createDiagramTranslator(options.lang ?? next.lang);
        options.onSetChange?.(next, source);
    };

    on(screen, 'click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) {
            if (!event.target.closest('.dx-menu')) closeMenus();
            return;
        }
        const action = target.dataset.action;
        if (action !== 'export-menu' && action !== 'import-menu') closeMenus();
        switch (action) {
            case 'theme':
                state.theme = state.theme === 'dark' ? 'light' : 'dark';
                writeStorage(THEME_KEY, state.theme);
                applyAppTheme();
                if (state.viewer) {
                    screen.querySelector('[data-action="theme"]').innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon');
                } else {
                    renderGallery();
                }
                break;
            case 'import-menu':
            case 'export-menu':
                toggleMenu(target);
                break;
            case 'import-file':
                fileInput.click();
                break;
            case 'import-paste':
                openPaste();
                break;
            case 'forget':
                forget();
                break;
            case 'export':
                runExport(target.dataset.kind, target.dataset.scale);
                break;
            case 'steps':
                if (state.viewer.step >= 0) state.viewer.steps.stop();
                else state.viewer.steps.start();
                break;
            case 'fullscreen': {
                const element = root;
                if (doc.fullscreenElement) doc.exitFullscreen?.();
                else element.requestFullscreen?.().catch((error) => console.error('diagram explorer: fullscreen failed', error));
                break;
            }
            case 'inspector':
                state.inspectorOpen = !state.inspectorOpen;
                if (state.inspectorOpen && win.innerWidth <= 860) state.sidebarOpen = false;
                setPanels();
                break;
            case 'sidebar':
                state.sidebarOpen = !state.sidebarOpen;
                if (state.sidebarOpen && win.innerWidth <= 1100) state.inspectorOpen = false;
                setPanels();
                break;
            case 'close-panels':
                if (win.innerWidth <= 860) state.sidebarOpen = false;
                if (win.innerWidth <= 1100) state.inspectorOpen = false;
                setPanels();
                break;
            case 'select': {
                const type = target.dataset.type;
                const id = target.dataset.id;
                state.viewer.select({ type, id });
                state.viewer.centerOn(id);
                break;
            }
            case 'reveal':
                state.viewer.reveal(target.dataset.id);
                break;
            case 'clear-selection':
                state.viewer.select(null);
                break;
            case 'open-detail': {
                const diagram = state.viewer.diagram;
                const id = target.dataset.id;
                const source = diagram.kind === 'sequence'
                    ? diagram.participants.find((participant) => participant.id === id)
                    : diagram.nodes.find((node) => node.id === id) ?? diagram.groups.find((group) => group.id === id);
                if (source?.link) state.viewer.navigate(source.link);
                break;
            }
            case 'toggle-expand':
                state.viewer.toggleExpand(target.dataset.id);
                renderInspector();
                break;
            case 'toggle-group':
                state.viewer.toggleGroup(target.dataset.id);
                renderInspector();
                break;
            case 'toggle-tag': {
                const tags = state.viewer.filter.tags;
                const tag = target.dataset.tag;
                if (tags.has(tag)) tags.delete(tag);
                else tags.add(tag);
                state.viewer.setFilter({ tags });
                renderInspector();
                break;
            }
            case 'clear-filters':
                state.viewer.setFilter({ tags: [], query: '' });
                renderInspector();
                break;
            case 'play-steps':
                state.viewer.steps.start();
                state.viewer.steps.play();
                break;
            case 'go-step':
                state.viewer.steps.go(Number(target.dataset.index));
                break;
            default:
                break;
        }
    });

    on(screen, 'input', (event) => {
        const input = event.target.closest('[data-input]');
        if (!input || !state.workspace) return;
        if (input.dataset.input === 'sidebar-search') {
            state.workspace.query = input.value;
            screen.querySelector('.dx-list').innerHTML = sidebarMarkup(state.viewer?.diagram?.id);
        } else if (input.dataset.input === 'find') {
            state.workspace.find = input.value;
            renderInspector();
        }
    });

    on(screen, 'keydown', (event) => {
        if (event.key === 'Escape' && screen.querySelector('.dx-menu:not([hidden])')) {
            const open = screen.querySelector('.dx-menu:not([hidden])');
            closeMenus();
            open.previousElementSibling?.focus();
            event.stopPropagation();
            return;
        }
        const menu = event.target.closest?.('.dx-menu');
        if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const items = [...menu.querySelectorAll('[role="menuitem"]')];
            const index = items.indexOf(doc.activeElement);
            const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            next?.focus();
        }
    });

    on(fileInput, 'change', () => {
        const [file] = fileInput.files ?? [];
        fileInput.value = '';
        importFile(file);
    });

    let dragDepth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    on(win, 'dragenter', (event) => {
        if (!features.import || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth += 1;
        veil.hidden = false;
    });
    on(win, 'dragover', (event) => {
        if (!features.import || !hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    on(win, 'dragleave', (event) => {
        if (!features.import || !hasFiles(event)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) veil.hidden = true;
    });
    on(win, 'drop', (event) => {
        if (!features.import || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth = 0;
        veil.hidden = true;
        importFile(event.dataTransfer.files?.[0]);
    });
    on(doc, 'paste', (event) => {
        if (!features.import || dialog.open) return;
        const target = event.target;
        if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
        const file = event.clipboardData?.files?.[0];
        if (file) {
            event.preventDefault();
            importFile(file);
            return;
        }
        const text = event.clipboardData?.getData('text/plain');
        if (text && text.trim()) {
            event.preventDefault();
            openPaste(text);
        }
    });
    on(doc, 'fullscreenchange', () => {
        const button = screen.querySelector('[data-action="fullscreen"]');
        if (!button) return;
        const active = Boolean(doc.fullscreenElement);
        button.innerHTML = icon(active ? 'minimize' : 'maximize');
        button.setAttribute('aria-label', t(active ? 'topbar.exitFullscreen' : 'topbar.fullscreen'));
        button.title = button.getAttribute('aria-label');
    });
    on(win, 'hashchange', handleRoute);
    if (typeof win.matchMedia === 'function') {
        const media = win.matchMedia('(prefers-color-scheme: dark)');
        const follow = () => {
            if (readTheme()) return;
            state.theme = systemTheme();
            applyAppTheme();
            if (!state.viewer) renderGallery();
        };
        media.addEventListener?.('change', follow);
        listeners.push(() => media.removeEventListener?.('change', follow));
    }

    let markReady;
    const ready = new Promise((resolve) => { markReady = resolve; });
    const readyObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => {
        if (doc.documentElement.dataset.capidocs === 'ready') {
            readyObserver.disconnect();
            markReady();
        }
    }) : null;
    readyObserver?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-capidocs'] });
    listeners.push(() => readyObserver?.disconnect());

    handleRoute();

    return {
        ready,
        get set() { return state.set; },
        get viewer() { return state.viewer; },
        get route() { return { ...state.route }; },
        get theme() { return state.theme; },
        importText,
        setSet(next, source = 'default') {
            setSet(next, source);
            handleRoute();
        },
        destroy() {
            state.destroyed = true;
            destroyViewer();
            state.thumbObserver?.disconnect();
            listeners.forEach((off) => off());
            root.innerHTML = '';
        }
    };
}
