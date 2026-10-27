import { findDiagram, parseDiagramSetJson, serializeDiagramSet, validateDiagramSet } from './model.js';
import { mountDiagram } from './viewer.js';

export const HANDOFF_KEY = 'capidocs.diagrams.handoff';

const mounted = new Set();
const cache = new Map();

function sameOrigin(src, base) {
    try {
        const url = new URL(src, base);
        return url.origin === new URL(base).origin ? url : null;
    } catch {
        return null;
    }
}

async function loadSet(block, doc) {
    const inline = block.querySelector('script[data-diagram-set]');
    if (inline) {
        const result = validateDiagramSet(JSON.parse(inline.textContent));
        if (!result.ok) throw Object.assign(new Error('invalid diagram set'), { issues: result.issues });
        return result.set;
    }
    const url = sameOrigin(block.dataset.src, doc.baseURI);
    if (!url) throw new Error('diagram sources must be on the same origin');
    if (!cache.has(url.href)) {
        cache.set(url.href, fetch(url, { credentials: 'same-origin' }).then(async (response) => {
            if (!response.ok) throw new Error(`diagram source responded ${response.status}`);
            const result = parseDiagramSetJson(await response.text());
            if (!result.ok) throw Object.assign(new Error('invalid diagram set'), { issues: result.issues });
            return result.set;
        }));
    }
    try {
        return await cache.get(url.href);
    } catch (error) {
        cache.delete(url.href);
        throw error;
    }
}

function releaseDetached() {
    for (const viewer of mounted) {
        if (viewer.root.isConnected) continue;
        viewer.destroy();
        mounted.delete(viewer);
    }
}

export async function mountDiagramBlocks(container, { t = (key, fallback) => fallback, openExplorer = null } = {}) {
    releaseDetached();
    const doc = container.ownerDocument;
    const blocks = [...container.querySelectorAll('[data-diagram-block]:not([data-mounted])')];
    const viewers = [];
    for (const block of blocks) {
        block.dataset.mounted = 'true';
        const canvas = block.querySelector('.diagram-block-canvas');
        canvas.style.height = `${Number(block.dataset.height) || 480}px`;
        let set;
        try {
            set = await loadSet(block, doc);
        } catch (error) {
            console.error('capidocs: diagram block could not load', error);
            canvas.innerHTML = '';
            const message = doc.createElement('p');
            message.className = 'diagram-block-status';
            message.textContent = t('diagram_error', 'No se pudo cargar el diagrama.');
            canvas.appendChild(message);
            block.querySelector('.diagram-block-open')?.remove();
            continue;
        }
        const requested = block.dataset.diagram;
        const diagramId = requested && findDiagram(set, requested) ? requested : set.start ?? set.diagrams[0]?.id;
        canvas.innerHTML = '';
        const viewer = mountDiagram(canvas, { set, diagramId, theme: 'auto', wheel: 'ctrl', lang: doc.documentElement.lang || set.lang });
        mounted.add(viewer);
        viewers.push(viewer);
        if (typeof openExplorer === 'function') {
            block.querySelector('.diagram-block-open')?.addEventListener('click', (event) => {
                event.preventDefault();
                openExplorer({ set: serializeDiagramSet(set), diagram: viewer.diagram?.id ?? diagramId });
            });
            continue;
        }
        const open = block.querySelector('[data-diagram-handoff]');
        open?.addEventListener('click', () => {
            try {
                localStorage.setItem(HANDOFF_KEY, JSON.stringify(serializeDiagramSet(set)));
            } catch (error) {
                console.error('capidocs: diagram handoff failed', error);
            }
        });
    }
    return viewers;
}
