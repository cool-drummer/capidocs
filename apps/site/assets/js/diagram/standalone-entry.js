import { validateDiagramSet } from './model.js';
import { mountExplorer } from './explorer.js';
import { svgToRaster } from './export/raster.js';
import { buildPdf } from './export/pdf.js';
import { downloadBlob } from './export/download.js';

const SET_ID = 'capidocs-diagram-set';
const ROOT_ID = 'capidocs-standalone';

function readSet() {
    try {
        return validateDiagramSet(JSON.parse(document.getElementById(SET_ID)?.textContent ?? 'null'));
    } catch (error) {
        console.error('diagram standalone: the embedded set could not be read', error);
        return { ok: false };
    }
}

async function mount() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        document.body.appendChild(root);
    }
    const result = readSet();
    if (!result.ok) {
        document.documentElement.dataset.capidocs = 'failed';
        return;
    }
    document.documentElement.lang = result.set.lang || 'es';
    const explorer = mountExplorer(root, {
        set: result.set,
        source: 'embedded',
        storages: null,
        features: { import: false, export: ['svg', 'png', 'jpg', 'pdf', 'json'], storage: false },
        services: { svgToRaster, buildPdf, downloadBlob }
    });
    window.capidocsDiagrams = explorer;
    await explorer.ready;
    document.documentElement.dataset.capidocs = 'ready';
}

mount();
