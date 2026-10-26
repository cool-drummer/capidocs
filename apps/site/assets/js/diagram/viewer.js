import { findDiagram } from './model.js';
import { approximateMeasure, createCanvasMeasure } from './metrics.js';
import { defaultCollapsed, defaultExpanded, layoutDiagram } from './layout/index.js';
import { renderSceneContent, renderSvg } from './render/svg.js';
import { applyTheme, readSiteAccent } from './theme.js';
import { createDiagramTranslator } from './i18n.js';
import { BUILTIN_ICONS } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const FIT_PADDING = 32;
const READABLE_ZOOM = 0.62;
const DRAG_THRESHOLD = 4;
const STEP_INTERVAL = 3200;
const FONT_FACES = ['400 12px Geist', '500 12px Geist', '600 13px Geist', '400 12px "Geist Mono"'];

let fontsPromise = null;

export function ensureFonts(doc = globalThis.document) {
    if (fontsPromise) return fontsPromise;
    const fonts = doc?.fonts;
    if (!fonts?.load) {
        fontsPromise = Promise.resolve(false);
        return fontsPromise;
    }
    const loading = Promise.all(FONT_FACES.map((face) => fonts.load(face).catch(() => null))).then(() => true);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 2500));
    fontsPromise = Promise.race([loading, timeout]);
    return fontsPromise;
}

export function ensureStylesheet(doc = globalThis.document) {
    if (!doc?.head || doc.querySelector('[data-dg-styles]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../css/diagram-viewer.css', import.meta.url).href;
    link.dataset.dgStyles = '';
    doc.head.appendChild(link);
}

export function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function resolveTheme(option, doc) {
    if (option === 'light' || option === 'dark') return option;
    const attr = doc.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function iconSvg(name, size = 16) {
    const icon = BUILTIN_ICONS[name];
    if (!icon) return '';
    const paths = icon.paths.map((d) => `<path d="${d}"/>`).join('');
    return `<svg class="dg-ui-icon" width="${size}" height="${size}" viewBox="${icon.viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function button(doc, { className, icon, label, action, text }) {
    const element = doc.createElement('button');
    element.type = 'button';
    element.className = className;
    element.dataset.viewerAction = action;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.innerHTML = icon ? iconSvg(icon) : '';
    if (text) {
        const span = doc.createElement('span');
        span.textContent = text;
        element.appendChild(span);
    }
    return element;
}

function sceneItems(scene) {
    if (scene.kind === 'sequence') {
        return {
            nodes: scene.participants.map((participant) => ({ id: participant.id, x: participant.x, y: participant.y, w: participant.w, h: participant.h, source: participant.source })),
            edges: scene.messages.map((message) => ({ id: message.id, from: message.from, to: message.to, source: message.source }))
        };
    }
    return {
        nodes: [...scene.nodes, ...scene.groups.map((group) => ({ ...group, isGroup: true }))],
        edges: scene.edges
    };
}

function selectorValue(value) {
    return String(value).replace(/["\\]/g, '\\$&');
}

function easeOut(t) {
    return 1 - (1 - t) ** 3;
}

export function mountDiagram(container, options = {}) {
    const doc = container.ownerDocument;
    const {
        set,
        diagramId,
        theme = 'auto',
        accent,
        onNavigate,
        onSelect,
        onRender,
        onStep,
        interactive = true,
        lang = set?.lang,
        wheel = 'zoom',
        controls = true,
        maxInitialZoom = 1.25
    } = options;
    if (!set) throw new Error('mountDiagram requires a diagram set');
    ensureStylesheet(doc);
    const t = createDiagramTranslator(lang);
    const reducedMotion = prefersReducedMotion();
    const listeners = [];
    const on = (target, type, handler, opts) => {
        target.addEventListener(type, handler, opts);
        listeners.push(() => target.removeEventListener(type, handler, opts));
    };

    const root = doc.createElement('div');
    root.className = 'dg-viewer';
    if (!interactive) root.classList.add('dg-static');
    const viewport = doc.createElement('div');
    viewport.className = 'dg-viewport';
    viewport.tabIndex = interactive ? 0 : -1;
    viewport.setAttribute('role', interactive ? 'application' : 'img');
    viewport.setAttribute('aria-roledescription', t('viewer.roleDescription'));
    const hint = doc.createElement('p');
    hint.className = 'dg-sr-only';
    hint.id = `dg-hint-${Math.random().toString(36).slice(2, 9)}`;
    hint.textContent = t('viewer.focusHint');
    if (interactive) viewport.setAttribute('aria-describedby', hint.id);
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'dg-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('aria-hidden', 'false');
    const camera = doc.createElementNS(SVG_NS, 'g');
    camera.setAttribute('class', 'dg-camera');
    const content = doc.createElementNS(SVG_NS, 'g');
    content.setAttribute('class', 'dg-content');
    camera.appendChild(content);
    svg.appendChild(camera);
    viewport.appendChild(svg);
    root.appendChild(viewport);
    root.appendChild(hint);
    const live = doc.createElement('div');
    live.className = 'dg-sr-only';
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);

    const trailBar = doc.createElement('nav');
    trailBar.className = 'dg-trail';
    trailBar.setAttribute('aria-label', t('viewer.trail'));
    trailBar.hidden = true;
    root.appendChild(trailBar);

    let zoomLabel = null;
    if (controls && interactive) {
        const bar = doc.createElement('div');
        bar.className = 'dg-zoom';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', t('viewer.controls'));
        bar.appendChild(button(doc, { className: 'dg-tool', icon: 'minus', label: t('viewer.zoomOut'), action: 'zoom-out' }));
        zoomLabel = button(doc, { className: 'dg-tool dg-zoom-value', label: t('viewer.actual'), action: 'actual', text: '100 %' });
        bar.appendChild(zoomLabel);
        bar.appendChild(button(doc, { className: 'dg-tool', icon: 'plus', label: t('viewer.zoomIn'), action: 'zoom-in' }));
        bar.appendChild(button(doc, { className: 'dg-tool', icon: 'scan', label: t('viewer.fit'), action: 'fit' }));
        root.appendChild(bar);
    }

    const player = doc.createElement('div');
    player.className = 'dg-player';
    player.hidden = true;
    player.setAttribute('role', 'region');
    player.setAttribute('aria-label', t('steps.title'));
    player.innerHTML = `
        <div class="dg-player-text"><span class="dg-player-count"></span><strong class="dg-player-title"></strong><span class="dg-player-desc"></span></div>
        <div class="dg-player-actions"></div>`;
    const playerActions = player.querySelector('.dg-player-actions');
    playerActions.appendChild(button(doc, { className: 'dg-tool', icon: 'skip-back', label: t('steps.prev'), action: 'step-prev' }));
    const playButton = button(doc, { className: 'dg-tool dg-tool-strong', icon: 'play', label: t('steps.play'), action: 'step-play' });
    playerActions.appendChild(playButton);
    playerActions.appendChild(button(doc, { className: 'dg-tool', icon: 'skip-forward', label: t('steps.next'), action: 'step-next' }));
    playerActions.appendChild(button(doc, { className: 'dg-tool', icon: 'x', label: t('steps.close'), action: 'step-close' }));
    root.appendChild(player);

    container.appendChild(root);

    const state = {
        diagram: null,
        scene: null,
        items: null,
        theme: resolveTheme(theme, doc),
        accent: accent ?? null,
        camera: { x: 0, y: 0, k: 1 },
        userMoved: false,
        selection: null,
        hover: null,
        step: -1,
        playing: false,
        playTimer: null,
        filter: { tags: new Set(), query: '' },
        trail: [],
        expandedBy: new Map(),
        collapsedBy: new Map(),
        measure: approximateMeasure,
        destroyed: false
    };

    const applyColors = () => {
        const siteAccent = readSiteAccent(doc);
        const brand = state.accent ?? (siteAccent ? { light: siteAccent, dark: siteAccent } : undefined);
        applyTheme(root, state.theme, brand);
        root.dataset.dgTheme = state.theme;
        return brand;
    };
    let brandAccent = applyColors();

    const expandedSet = () => {
        if (!state.expandedBy.has(state.diagram.id)) state.expandedBy.set(state.diagram.id, defaultExpanded(state.diagram));
        return state.expandedBy.get(state.diagram.id);
    };
    const collapsedSet = () => {
        if (!state.collapsedBy.has(state.diagram.id)) state.collapsedBy.set(state.diagram.id, defaultCollapsed(state.diagram));
        return state.collapsedBy.get(state.diagram.id);
    };

    const viewportSize = () => {
        const rect = viewport.getBoundingClientRect();
        return { w: rect.width || viewport.clientWidth || 800, h: rect.height || viewport.clientHeight || 600 };
    };

    const applyCamera = () => {
        const { x, y, k } = state.camera;
        camera.setAttribute('transform', `translate(${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}) scale(${Math.round(k * 10000) / 10000})`);
        if (zoomLabel) zoomLabel.querySelector('span').textContent = t('viewer.zoomLevel', { value: Math.round(k * 100) });
    };

    let cameraAnimation = null;
    const setCamera = (target, animate = true) => {
        if (cameraAnimation) cancelAnimationFrame(cameraAnimation);
        cameraAnimation = null;
        if (!animate || reducedMotion || typeof requestAnimationFrame !== 'function') {
            state.camera = { ...target };
            applyCamera();
            return;
        }
        const start = { ...state.camera };
        const began = performance.now();
        const duration = 260;
        const tick = () => {
            const progress = Math.max(0, Math.min(1, (performance.now() - began) / duration));
            const eased = easeOut(progress);
            state.camera = {
                x: start.x + (target.x - start.x) * eased,
                y: start.y + (target.y - start.y) * eased,
                k: start.k + (target.k - start.k) * eased
            };
            applyCamera();
            cameraAnimation = progress < 1 ? requestAnimationFrame(tick) : null;
        };
        cameraAnimation = requestAnimationFrame(tick);
    };

    const fitBox = (box, { maxZoom = maxInitialZoom, padding = FIT_PADDING } = {}) => {
        const view = viewportSize();
        const k = Math.max(MIN_ZOOM, Math.min(maxZoom, (view.w - padding * 2) / box.w, (view.h - padding * 2) / box.h));
        return { k, x: view.w / 2 - (box.x + box.w / 2) * k, y: view.h / 2 - (box.y + box.h / 2) * k };
    };

    const fit = (animate = true) => {
        if (!state.scene) return;
        setCamera(fitBox({ x: 0, y: 0, w: state.scene.width, h: state.scene.height }), animate);
        state.userMoved = false;
    };

    const initialView = () => {
        if (!state.scene) return;
        const whole = fitBox({ x: 0, y: 0, w: state.scene.width, h: state.scene.height });
        if (whole.k >= READABLE_ZOOM) {
            setCamera(whole, false);
            state.userMoved = false;
            return;
        }
        const view = viewportSize();
        const k = READABLE_ZOOM;
        const w = state.scene.width * k;
        const h = state.scene.height * k;
        const direction = state.scene.direction;
        const alignX = w <= view.w - FIT_PADDING * 2 ? (view.w - w) / 2 : direction === 'RL' ? view.w - FIT_PADDING / 2 - w : FIT_PADDING / 2;
        const alignY = h <= view.h - FIT_PADDING * 2 ? (view.h - h) / 2 : direction === 'BT' ? view.h - FIT_PADDING / 2 - h : FIT_PADDING / 2;
        setCamera({ k, x: alignX, y: alignY }, false);
        state.userMoved = false;
    };

    const zoomAt = (factor, cx, cy, animate = false) => {
        const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.camera.k * factor));
        const ratio = k / state.camera.k;
        setCamera({ k, x: cx - (cx - state.camera.x) * ratio, y: cy - (cy - state.camera.y) * ratio }, animate);
        state.userMoved = true;
    };

    const zoomCenter = (factor) => {
        const view = viewportSize();
        zoomAt(factor, view.w / 2, view.h / 2, true);
    };

    const actualSize = () => {
        const view = viewportSize();
        const cx = (view.w / 2 - state.camera.x) / state.camera.k;
        const cy = (view.h / 2 - state.camera.y) / state.camera.k;
        setCamera({ k: 1, x: view.w / 2 - cx, y: view.h / 2 - cy }, true);
        state.userMoved = true;
    };

    const panBy = (dx, dy) => {
        setCamera({ ...state.camera, x: state.camera.x + dx, y: state.camera.y + dy }, false);
        state.userMoved = true;
    };

    const nodeElement = (id) => content.querySelector(`[data-node="${selectorValue(id)}"]`);
    const groupChipElement = (id) => content.querySelector(`.dg-group-chip[data-group="${selectorValue(id)}"]`);
    const itemById = (id) => state.items?.nodes.find((item) => item.id === id) ?? null;

    const centerOn = (id, { zoom } = {}) => {
        const item = itemById(id);
        if (!item) return;
        const view = viewportSize();
        const k = zoom ?? Math.max(state.camera.k, 0.8);
        setCamera({ k, x: view.w / 2 - (item.x + item.w / 2) * k, y: view.h / 2 - (item.y + item.h / 2) * k }, true);
        state.userMoved = true;
    };

    const neighbours = (id) => {
        const edges = state.items.edges.filter((edge) => edge.from === id || edge.to === id);
        const nodes = new Set([id]);
        for (const edge of edges) {
            nodes.add(edge.from);
            nodes.add(edge.to);
        }
        return { edges: new Set(edges.map((edge) => edge.id)), nodes };
    };

    const clearMarks = (className) => {
        for (const element of content.querySelectorAll(`.${className}`)) element.classList.remove(className);
    };

    const markSet = ({ nodes = new Set(), edges = new Set(), groups = new Set() }, className) => {
        clearMarks(className);
        for (const element of content.querySelectorAll('[data-node]')) if (nodes.has(element.dataset.node)) element.classList.add(className);
        for (const element of content.querySelectorAll('[data-group]')) if (groups.has(element.dataset.group) || nodes.has(element.dataset.group)) element.classList.add(className);
        for (const element of content.querySelectorAll('[data-edge]')) if (edges.has(element.dataset.edge)) element.classList.add(className);
    };

    const applyHover = () => {
        if (state.hover && state.step < 0) {
            markSet(neighbours(state.hover), 'dg-hl');
            root.classList.add('dg-hover-mode');
        } else {
            clearMarks('dg-hl');
            root.classList.remove('dg-hover-mode');
        }
    };

    const matchesFilter = (node) => {
        const { tags, query } = state.filter;
        const source = node.source ?? {};
        if (tags.size && !(source.tags ?? []).some((tag) => tags.has(tag))) return false;
        if (query) {
            const haystack = `${source.title ?? ''} ${source.subtitle ?? ''} ${source.id ?? ''}`.toLowerCase();
            if (!haystack.includes(query.toLowerCase())) return false;
        }
        return true;
    };

    const applyFilter = () => {
        const active = state.filter.tags.size > 0 || Boolean(state.filter.query);
        root.classList.toggle('dg-filter-mode', active);
        clearMarks('dg-match');
        if (!active || !state.items) return;
        const matched = new Set(state.items.nodes.filter((node) => !node.isGroup && matchesFilter(node)).map((node) => node.id));
        const edges = new Set(state.items.edges.filter((edge) => matched.has(edge.from) && matched.has(edge.to)).map((edge) => edge.id));
        markSet({ nodes: matched, edges }, 'dg-match');
    };

    const applySelection = () => {
        clearMarks('dg-selected');
        if (!state.selection) return;
        const { type, id } = state.selection;
        if (type === 'node') nodeElement(id)?.classList.add('dg-selected');
        if (type === 'group') groupChipElement(id)?.classList.add('dg-selected');
        if (type === 'edge') for (const element of content.querySelectorAll(`[data-edge="${selectorValue(id)}"]`)) element.classList.add('dg-selected');
    };

    const currentSteps = () => state.diagram?.steps ?? [];

    const applyStep = () => {
        const steps = currentSteps();
        const active = state.step >= 0 && state.step < steps.length;
        root.classList.toggle('dg-step-mode', active);
        player.hidden = !active;
        if (!active) {
            clearMarks('dg-step');
            return;
        }
        const step = steps[state.step];
        markSet({ nodes: new Set(step.nodes), edges: new Set(step.edges), groups: new Set(step.groups) }, 'dg-step');
        player.querySelector('.dg-player-count').textContent = t('steps.counter', { current: state.step + 1, total: steps.length });
        player.querySelector('.dg-player-title').textContent = step.title;
        player.querySelector('.dg-player-desc').textContent = step.description ?? '';
        playButton.innerHTML = iconSvg(state.playing ? 'pause' : 'play');
        playButton.setAttribute('aria-label', state.playing ? t('steps.pause') : t('steps.play'));
        playButton.title = playButton.getAttribute('aria-label');
        live.textContent = t('steps.announce', { current: state.step + 1, total: steps.length, title: step.title });
    };

    const focusStep = () => {
        const steps = currentSteps();
        const step = steps[state.step];
        if (!step || !state.items) return;
        const ids = new Set([...step.nodes, ...step.groups]);
        for (const edge of state.items.edges) {
            if (step.edges.includes(edge.id)) {
                ids.add(edge.from);
                ids.add(edge.to);
            }
        }
        const boxes = state.items.nodes.filter((item) => ids.has(item.id));
        if (!boxes.length) return;
        const minX = Math.min(...boxes.map((box) => box.x));
        const minY = Math.min(...boxes.map((box) => box.y));
        const maxX = Math.max(...boxes.map((box) => box.x + box.w));
        const maxY = Math.max(...boxes.map((box) => box.y + box.h));
        const target = fitBox({ x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 }, { maxZoom: 1.1 });
        const whole = fitBox({ x: 0, y: 0, w: state.scene.width, h: state.scene.height });
        setCamera(target.k < whole.k ? whole : target, true);
    };

    const stopPlaying = () => {
        state.playing = false;
        if (state.playTimer) clearInterval(state.playTimer);
        state.playTimer = null;
    };

    const goToStep = (index) => {
        const steps = currentSteps();
        if (!steps.length) return;
        state.step = Math.max(-1, Math.min(steps.length - 1, index));
        if (state.step >= 0) {
            state.hover = null;
            applyHover();
        }
        applyStep();
        if (state.step >= 0) focusStep();
        onStep?.(state.step);
    };

    const togglePlay = () => {
        const steps = currentSteps();
        if (!steps.length) return;
        if (state.playing) {
            stopPlaying();
            applyStep();
            return;
        }
        state.playing = true;
        if (state.step < 0 || state.step >= steps.length - 1) goToStep(0);
        else applyStep();
        state.playTimer = setInterval(() => {
            if (state.step >= currentSteps().length - 1) {
                stopPlaying();
                applyStep();
                return;
            }
            goToStep(state.step + 1);
        }, STEP_INTERVAL);
    };

    const exitSteps = () => {
        stopPlaying();
        goToStep(-1);
    };

    const renderTrail = () => {
        trailBar.innerHTML = '';
        if (state.trail.length < 2) {
            trailBar.hidden = true;
            return;
        }
        trailBar.hidden = false;
        const list = doc.createElement('ol');
        state.trail.forEach((entry, index) => {
            const item = doc.createElement('li');
            const diagram = findDiagram(set, entry);
            const title = diagram?.title ?? entry;
            if (index === state.trail.length - 1) {
                const current = doc.createElement('span');
                current.setAttribute('aria-current', 'page');
                current.textContent = title;
                item.appendChild(current);
            } else {
                const link = doc.createElement('button');
                link.type = 'button';
                link.className = 'dg-trail-link';
                link.dataset.viewerAction = 'trail';
                link.dataset.index = String(index);
                link.textContent = title;
                item.appendChild(link);
            }
            list.appendChild(item);
        });
        trailBar.appendChild(list);
    };

    const select = (selection, { silent = false } = {}) => {
        state.selection = selection;
        applySelection();
        if (selection && !silent) {
            const item = selection.type === 'edge' ? null : itemById(selection.id);
            const title = item?.source?.title ?? item?.title;
            if (title) live.textContent = t('viewer.selected', { title });
        }
        onSelect?.(selection ? { ...selection, diagram: state.diagram.id } : null);
    };

    const snapshot = () => {
        const positions = new Map();
        for (const element of content.querySelectorAll('.dg-node[data-node]')) {
            const item = itemById(element.dataset.node);
            if (item) positions.set(`n:${item.id}`, { x: item.x, y: item.y });
        }
        if (state.scene?.kind === 'graph') {
            for (const group of state.scene.groups) positions.set(`g:${group.id}`, { x: group.x, y: group.y, w: group.w, h: group.h, hx: group.header.x, hy: group.header.y });
        }
        return positions;
    };

    let flipFrame = null;
    const animateFrom = (previous) => {
        if (!previous || reducedMotion || typeof requestAnimationFrame !== 'function' || state.scene.kind !== 'graph') return;
        const tracks = [];
        for (const node of state.scene.nodes) {
            const before = previous.get(`n:${node.id}`);
            const element = nodeElement(node.id);
            if (!element) continue;
            if (!before) {
                element.classList.add('dg-entering');
                continue;
            }
            if (before.x === node.x && before.y === node.y) continue;
            tracks.push({ kind: 'node', element, from: before, to: { x: node.x, y: node.y } });
        }
        for (const group of state.scene.groups) {
            const before = previous.get(`g:${group.id}`);
            const area = content.querySelector(`.dg-group[data-group="${selectorValue(group.id)}"] rect`);
            const chip = groupChipElement(group.id);
            if (!before) continue;
            if (area) tracks.push({ kind: 'rect', element: area, from: before, to: group });
            if (chip) tracks.push({ kind: 'chip', element: chip, from: { x: before.hx - group.header.x, y: before.hy - group.header.y }, to: { x: 0, y: 0 } });
        }
        root.classList.add('dg-reflow');
        const began = performance.now();
        const duration = 240;
        const frame = () => {
            const progress = Math.max(0, Math.min(1, (performance.now() - began) / duration));
            const e = easeOut(progress);
            for (const track of tracks) {
                const x = track.from.x + (track.to.x - track.from.x) * e;
                const y = track.from.y + (track.to.y - track.from.y) * e;
                if (track.kind === 'node' || track.kind === 'chip') {
                    track.element.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
                } else {
                    track.element.setAttribute('x', x.toFixed(2));
                    track.element.setAttribute('y', y.toFixed(2));
                    track.element.setAttribute('width', (track.from.w + (track.to.w - track.from.w) * e).toFixed(2));
                    track.element.setAttribute('height', (track.from.h + (track.to.h - track.from.h) * e).toFixed(2));
                }
            }
            if (progress < 1) {
                flipFrame = requestAnimationFrame(frame);
            } else {
                flipFrame = null;
                for (const track of tracks) if (track.kind === 'chip') track.element.removeAttribute('transform');
                root.classList.remove('dg-reflow');
                for (const element of content.querySelectorAll('.dg-entering')) element.classList.remove('dg-entering');
            }
        };
        if (flipFrame) cancelAnimationFrame(flipFrame);
        flipFrame = requestAnimationFrame(frame);
    };

    const render = ({ animate = false, keepCamera = true } = {}) => {
        if (!state.diagram) return;
        const previous = animate ? snapshot() : null;
        state.scene = layoutDiagram(state.diagram, { measure: state.measure, expanded: expandedSet(), collapsed: collapsedSet() });
        state.items = sceneItems(state.scene);
        const { markup } = renderSceneContent(state.scene, { mode: 'interactive', theme: state.theme, set, accent: brandAccent });
        content.innerHTML = markup;
        root.dataset.kind = state.scene.kind;
        viewport.setAttribute('aria-label', t('viewer.label', { title: state.diagram.title }));
        applySelection();
        applyFilter();
        applyHover();
        applyStep();
        if (!keepCamera || !state.userMoved) initialView();
        animateFrom(previous);
        onRender?.(state.scene, state.diagram);
    };

    const setDiagram = (id, { node, push = false, reset = true } = {}) => {
        const diagram = findDiagram(set, id) ?? set.diagrams[0];
        if (!diagram) return false;
        stopPlaying();
        const changed = state.diagram?.id !== diagram.id;
        state.diagram = diagram;
        state.step = -1;
        state.hover = null;
        if (changed || reset) state.selection = null;
        if (push) {
            const existing = state.trail.indexOf(diagram.id);
            if (existing >= 0) state.trail = state.trail.slice(0, existing + 1);
            else state.trail.push(diagram.id);
        } else if (reset) {
            state.trail = [diagram.id];
        }
        renderTrail();
        state.userMoved = false;
        render({ keepCamera: false });
        if (node && itemById(node)) {
            select({ type: state.diagram.groups?.some((group) => group.id === node) ? 'group' : 'node', id: node });
            centerOn(node, { zoom: Math.max(0.9, Math.min(1.1, state.camera.k)) });
        }
        return true;
    };

    const navigateLink = (link) => {
        if (!link) return;
        if (link.diagram) {
            if (onNavigate) onNavigate({ diagram: link.diagram, node: link.node, from: state.diagram.id });
            else setDiagram(link.diagram, { node: link.node, push: true });
            return;
        }
        if (link.href) {
            const opened = globalThis.open?.(link.href, '_blank', 'noopener,noreferrer');
            if (opened) opened.opener = null;
        }
    };

    const sourceOf = (id) => {
        if (!state.diagram) return null;
        if (state.diagram.kind === 'sequence') return state.diagram.participants.find((participant) => participant.id === id) ?? null;
        return state.diagram.nodes.find((node) => node.id === id) ?? state.diagram.groups.find((group) => group.id === id) ?? null;
    };

    const toggleExpand = (id) => {
        const set = expandedSet();
        if (set.has(id)) set.delete(id);
        else set.add(id);
        render({ animate: true });
        const element = nodeElement(id);
        if (element && doc.activeElement !== element && root.contains(doc.activeElement)) element.focus({ preventScroll: true });
    };

    const toggleGroup = (id) => {
        const set = collapsedSet();
        if (set.has(id)) set.delete(id);
        else set.add(id);
        render({ animate: true });
        groupChipElement(id)?.focus({ preventScroll: true });
    };

    const focusNode = (id) => {
        const element = nodeElement(id) ?? groupChipElement(id);
        if (!element) return;
        for (const other of content.querySelectorAll('[tabindex="0"]')) other.setAttribute('tabindex', '-1');
        element.setAttribute('tabindex', '0');
        element.focus({ preventScroll: true });
        const item = itemById(id);
        if (!item) return;
        const view = viewportSize();
        const sx = item.x * state.camera.k + state.camera.x;
        const sy = item.y * state.camera.k + state.camera.y;
        const sw = item.w * state.camera.k;
        const sh = item.h * state.camera.k;
        if (sx < 16 || sy < 16 || sx + sw > view.w - 16 || sy + sh > view.h - 16) centerOn(id, { zoom: state.camera.k });
    };

    const spatialNeighbour = (id, dx, dy) => {
        const origin = itemById(id);
        if (!origin) return null;
        const ox = origin.x + origin.w / 2;
        const oy = origin.y + origin.h / 2;
        let best = null;
        for (const item of state.items.nodes) {
            if (item.id === id) continue;
            const cx = item.x + item.w / 2;
            const cy = item.y + item.h / 2;
            const along = (cx - ox) * dx + (cy - oy) * dy;
            if (along <= 1) continue;
            const across = Math.abs((cx - ox) * dy) + Math.abs((cy - oy) * dx);
            const score = along + across * 2.2;
            if (!best || score < best.score) best = { id: item.id, score };
        }
        return best?.id ?? null;
    };

    const activeNodeId = () => {
        const element = doc.activeElement;
        if (!element || !content.contains(element)) return null;
        return element.dataset?.node ?? element.dataset?.group ?? null;
    };

    const activate = (id, { viaKeyboard = false } = {}) => {
        const source = sourceOf(id);
        const isGroup = state.diagram.kind === 'graph' && state.diagram.groups.some((group) => group.id === id);
        select({ type: isGroup ? 'group' : 'node', id });
        if (viaKeyboard && source?.link) navigateLink(source.link);
    };

    on(viewport, 'keydown', (event) => {
        if (!interactive) return;
        const active = activeNodeId();
        const step = event.shiftKey ? 160 : 60;
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[event.key]) {
            event.preventDefault();
            const [dx, dy] = arrows[event.key];
            if (active) {
                const next = spatialNeighbour(active, dx, dy);
                if (next) focusNode(next);
            } else {
                panBy(-dx * step, -dy * step);
            }
            return;
        }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomCenter(1.2); return; }
        if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomCenter(1 / 1.2); return; }
        if (event.key === '0') { event.preventDefault(); actualSize(); return; }
        if (event.key === 'f' || event.key === 'F') { event.preventDefault(); fit(true); return; }
        if (event.key === 'Escape') {
            if (state.step >= 0) { exitSteps(); return; }
            if (active) { viewport.focus({ preventScroll: true }); return; }
            if (state.selection) select(null);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (active) {
                const chip = doc.activeElement.closest?.('.dg-group-chip');
                if (chip) toggleGroup(chip.dataset.group);
                else activate(active, { viaKeyboard: true });
                return;
            }
            const first = state.selection?.id ?? state.items?.nodes[0]?.id;
            if (first) focusNode(first);
            return;
        }
        if (event.key === ' ' && active) {
            event.preventDefault();
            const source = sourceOf(active);
            if (source?.props?.length || source?.preview?.values?.length) toggleExpand(active);
            else activate(active);
        }
    });

    on(viewport, 'focusin', (event) => {
        const target = event.target.closest?.('[data-node], .dg-group-chip');
        if (!target) return;
        for (const other of content.querySelectorAll('[tabindex="0"]')) if (other !== target) other.setAttribute('tabindex', '-1');
        target.setAttribute('tabindex', '0');
    });

    const pointers = new Map();
    let drag = null;
    let pinch = null;
    on(viewport, 'pointerdown', (event) => {
        if (!interactive || event.button > 0) return;
        if (event.target.closest?.('button, a, input')) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: state.camera.k };
            drag = null;
            return;
        }
        drag = { x: event.clientX, y: event.clientY, cx: state.camera.x, cy: state.camera.y, moved: false, target: event.target };
        viewport.setPointerCapture?.(event.pointerId);
    });
    on(viewport, 'pointermove', (event) => {
        if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const rect = viewport.getBoundingClientRect();
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const factor = (pinch.k * (distance / pinch.distance)) / state.camera.k;
            zoomAt(factor, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
            return;
        }
        if (drag) {
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
                drag.moved = true;
                root.classList.add('dg-panning');
            }
            if (drag.moved) {
                state.camera = { ...state.camera, x: drag.cx + dx, y: drag.cy + dy };
                state.userMoved = true;
                applyCamera();
            }
            return;
        }
        if (event.pointerType === 'mouse') {
            const target = event.target.closest?.('[data-node]');
            const id = target?.dataset.node ?? null;
            if (id !== state.hover) {
                state.hover = id;
                applyHover();
            }
        }
    });
    const endPointer = (event) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag) return;
        const finished = drag;
        drag = null;
        root.classList.remove('dg-panning');
        if (finished.moved || event.type === 'pointercancel') return;
        handleClick(finished.target, event);
    };
    on(viewport, 'pointerup', endPointer);
    on(viewport, 'pointercancel', endPointer);
    on(viewport, 'pointerleave', (event) => {
        if (event.pointerType === 'mouse' && state.hover) {
            state.hover = null;
            applyHover();
        }
    });

    const handleClick = (target) => {
        const actionElement = target.closest?.('[data-action]');
        if (actionElement && content.contains(actionElement)) {
            const action = actionElement.dataset.action;
            const id = actionElement.dataset.target;
            if (action === 'toggle-expand') toggleExpand(id);
            else if (action === 'toggle-group') toggleGroup(id);
            else if (action === 'open-link') navigateLink(sourceOf(id)?.link);
            return;
        }
        const nodeTarget = target.closest?.('[data-node]');
        if (nodeTarget) {
            select({ type: 'node', id: nodeTarget.dataset.node });
            nodeTarget.setAttribute('tabindex', '0');
            return;
        }
        const edgeTarget = target.closest?.('[data-edge]');
        if (edgeTarget) {
            select({ type: state.diagram.kind === 'sequence' ? 'message' : 'edge', id: edgeTarget.dataset.edge });
            return;
        }
        const groupTarget = target.closest?.('.dg-group[data-group]');
        if (groupTarget) {
            select({ type: 'group', id: groupTarget.dataset.group });
            return;
        }
        if (state.selection) select(null);
    };

    on(viewport, 'dblclick', (event) => {
        if (!interactive) return;
        const nodeTarget = event.target.closest?.('[data-node]');
        if (nodeTarget) {
            const source = sourceOf(nodeTarget.dataset.node);
            if (source?.link) navigateLink(source.link);
            else if (source?.props?.length || source?.preview?.values?.length) toggleExpand(nodeTarget.dataset.node);
            return;
        }
        const rect = viewport.getBoundingClientRect();
        zoomAt(1.6, event.clientX - rect.left, event.clientY - rect.top, true);
    });

    on(viewport, 'wheel', (event) => {
        if (!interactive) return;
        const rect = viewport.getBoundingClientRect();
        const zoomGesture = event.ctrlKey || event.metaKey;
        const mouseWheel = event.deltaMode === 1 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY));
        if (wheel === 'ctrl' && !zoomGesture) return;
        event.preventDefault();
        if (zoomGesture || (wheel === 'zoom' && mouseWheel)) {
            const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
            zoomAt(Math.exp(-delta * (zoomGesture ? 0.01 : 0.0022)), event.clientX - rect.left, event.clientY - rect.top);
        } else {
            panBy(-event.deltaX, -event.deltaY);
        }
    }, { passive: false });

    on(root, 'click', (event) => {
        const control = event.target.closest?.('[data-viewer-action]');
        if (!control || !root.contains(control)) return;
        const action = control.dataset.viewerAction;
        if (action === 'zoom-in') zoomCenter(1.25);
        else if (action === 'zoom-out') zoomCenter(1 / 1.25);
        else if (action === 'fit') fit(true);
        else if (action === 'actual') actualSize();
        else if (action === 'step-prev') { stopPlaying(); goToStep(Math.max(0, state.step - 1)); }
        else if (action === 'step-next') { stopPlaying(); goToStep(Math.min(currentSteps().length - 1, state.step + 1)); }
        else if (action === 'step-play') togglePlay();
        else if (action === 'step-close') exitSteps();
        else if (action === 'trail') {
            const index = Number(control.dataset.index);
            const target = state.trail[index];
            state.trail = state.trail.slice(0, index + 1);
            if (onNavigate) onNavigate({ diagram: target, back: true });
            else setDiagram(target, { push: true });
        }
    });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => {
            if (state.scene && !state.userMoved) initialView();
        });
        resizeObserver.observe(viewport);
    }

    let themeObserver = null;
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    const refreshTheme = () => {
        const next = resolveTheme(theme, doc);
        if (next === state.theme) return;
        state.theme = next;
        brandAccent = applyColors();
        render();
    };
    if (theme === 'auto') {
        if (typeof MutationObserver === 'function') {
            themeObserver = new MutationObserver(refreshTheme);
            themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        }
        media?.addEventListener?.('change', refreshTheme);
    }

    const ready = ensureFonts(doc).then(() => {
        if (state.destroyed || !doc.fonts) return;
        state.measure = createCanvasMeasure(doc);
        if (state.diagram) render({ keepCamera: true });
    });

    state.measure = doc.fonts?.status === 'loaded' ? createCanvasMeasure(doc) : approximateMeasure;
    setDiagram(diagramId ?? set.start ?? set.diagrams[0]?.id, { node: options.node });

    const controller = {
        root,
        ready,
        get diagram() { return state.diagram; },
        get scene() { return state.scene; },
        get selection() { return state.selection; },
        get camera() { return { ...state.camera }; },
        get trail() { return [...state.trail]; },
        get step() { return state.step; },
        get theme() { return state.theme; },
        setDiagram,
        select: (selection) => select(selection),
        focusNode,
        centerOn,
        fit: () => fit(true),
        zoomIn: () => zoomCenter(1.25),
        zoomOut: () => zoomCenter(1 / 1.25),
        actualSize,
        toggleExpand,
        toggleGroup,
        isExpanded: (id) => expandedSet().has(id),
        isCollapsed: (id) => collapsedSet().has(id),
        navigate: navigateLink,
        setTheme(next) {
            state.theme = next === 'dark' ? 'dark' : next === 'light' ? 'light' : resolveTheme('auto', doc);
            brandAccent = applyColors();
            render();
        },
        setFilter({ tags, query } = {}) {
            if (tags) state.filter.tags = new Set(tags);
            if (query !== undefined) state.filter.query = query;
            applyFilter();
        },
        get filter() { return { tags: new Set(state.filter.tags), query: state.filter.query }; },
        search(query) {
            const needle = String(query ?? '').trim().toLowerCase();
            if (!needle || !state.items) return [];
            return state.items.nodes
                .filter((item) => `${item.source?.title ?? item.title ?? ''} ${item.source?.subtitle ?? ''}`.toLowerCase().includes(needle))
                .map((item) => ({ id: item.id, title: item.source?.title ?? item.title, group: Boolean(item.isGroup) }));
        },
        reveal(id) {
            centerOn(id, { zoom: Math.max(1, state.camera.k) });
            select({ type: 'node', id });
            markSet({ nodes: new Set([id]) }, 'dg-flash');
            setTimeout(() => clearMarks('dg-flash'), 1600);
        },
        steps: {
            get index() { return state.step; },
            get playing() { return state.playing; },
            get list() { return currentSteps(); },
            start: () => goToStep(0),
            go: (index) => goToStep(index),
            next: () => goToStep(Math.min(currentSteps().length - 1, state.step + 1)),
            prev: () => goToStep(Math.max(0, state.step - 1)),
            play: () => { if (!state.playing) togglePlay(); },
            pause: () => { if (state.playing) togglePlay(); },
            stop: exitSteps
        },
        toSvg({ theme: exportTheme = state.theme, embedFontCss, background = true } = {}) {
            return renderSvg(state.scene, { mode: 'export', theme: exportTheme, set, diagram: state.diagram, embedFontCss, accent: brandAccent, title: state.diagram.title, background });
        },
        layoutFor(diagram, layoutOptions = {}) {
            return layoutDiagram(diagram, { measure: state.measure, ...layoutOptions });
        },
        destroy() {
            state.destroyed = true;
            stopPlaying();
            if (cameraAnimation) cancelAnimationFrame(cameraAnimation);
            if (flipFrame) cancelAnimationFrame(flipFrame);
            listeners.forEach((off) => off());
            resizeObserver?.disconnect();
            themeObserver?.disconnect();
            media?.removeEventListener?.('change', refreshTheme);
            root.remove();
        }
    };
    return controller;
}
