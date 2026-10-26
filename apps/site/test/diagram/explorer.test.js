import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { REMEMBER_DAYS, STORAGE_KEY, THEME_KEY, clearSavedData, linkDestination, mountExplorer, parseRoute, readSavedRecord, safeLocale, thumbnailWindow } from '../../assets/js/diagram/explorer.js';
import { HANDOFF_KEY } from '../../assets/js/diagram/blocks.js';

const siteDir = join(import.meta.dirname, '../..');
const readSet = (path) => validateDiagramSet(JSON.parse(readFileSync(join(siteDir, path), 'utf8'))).set;
const demo = readSet('config/diagrams/capidocs.json');
const sample = readSet('test/fixtures/diagrams/sample.json');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

async function go(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await tick();
}

describe('parseRoute', () => {
  it('understands the gallery, categories and deep links', () => {
    expect(parseRoute('')).toEqual({ view: 'home' });
    expect(parseRoute('#/c/technical')).toEqual({ view: 'category', category: 'technical' });
    expect(parseRoute('#/d/architecture')).toEqual({ view: 'diagram', diagram: 'architecture', node: null });
    expect(parseRoute('#/d/architecture/api')).toEqual({ view: 'diagram', diagram: 'architecture', node: 'api' });
    expect(parseRoute('#/d/%E0%A4%A')).toEqual({ view: 'diagram', diagram: '%E0%A4%A', node: null });
  });
});

describe('thumbnailWindow', () => {
  it('crops wide and tall scenes towards the start of the flow', () => {
    const wide = thumbnailWindow({ width: 2000, height: 400, direction: 'LR' }, 1.6);
    expect(wide.x).toBe(0);
    expect(wide.h).toBe(400);
    expect(wide.w).toBeLessThan(2000);
    const reverse = thumbnailWindow({ width: 2000, height: 400, direction: 'RL' }, 1.6);
    expect(reverse.x + reverse.w).toBe(2000);
    const tall = thumbnailWindow({ width: 400, height: 1600, direction: 'TB' }, 1.6);
    expect(tall.y).toBe(0);
    expect(tall.h).toBeLessThan(1600);
  });
});

describe('mountExplorer', () => {
  let root;
  let explorer;
  let storages;
  let services;

  beforeEach(async () => {
    window.location.hash = '';
    await tick();
    root = document.createElement('div');
    document.body.appendChild(root);
    storages = { session: memoryStorage(), local: memoryStorage() };
    services = {
      downloadBlob: vi.fn(async () => {}),
      svgToRaster: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
      buildPdf: vi.fn(() => new Uint8Array([37, 80, 68, 70])),
      fontCss: vi.fn(async () => '@font-face{font-family:"Geist";src:url(data:font/woff2;base64,AA==)}'),
      importDiagramFile: vi.fn(),
    };
  });

  afterEach(() => {
    explorer?.destroy();
    explorer = null;
    root.remove();
  });

  it('opens on a gallery grouped by category', () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    expect(root.querySelector('h1').textContent).toBe(demo.title);
    const cards = root.querySelectorAll('.dx-cat-card');
    expect([...cards].map((card) => card.querySelector('.dx-cat-title').textContent)).toEqual(['Técnicos', 'Operativos', 'Negocio']);
    expect(cards[0].querySelector('.dx-cat-link').textContent).toBe('Explorar técnicos');
    expect(cards[0].querySelector('svg')).not.toBeNull();
    expect(root.querySelectorAll('.dx-tile')).toHaveLength(demo.diagrams.length);
    expect(root.innerHTML).not.toMatch(/\sstyle="/);
  });

  it('filters the gallery by category', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/c/business');
    expect(root.querySelector('h1').textContent).toBe('Negocio');
    expect(root.querySelectorAll('.dx-tile')).toHaveLength(2);
  });

  it('opens a diagram with its list, breadcrumbs and inspector', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/architecture');
    expect(root.querySelector('.dx-list-item[aria-current="page"]').textContent.trim()).toBe('Arquitectura de capidocs');
    expect([...root.querySelectorAll('.dx-crumbs li')].map((item) => item.textContent.trim())).toEqual(['Diagramas de capidocs', 'Técnicos', 'Arquitectura de capidocs']);
    expect(root.querySelector('.dx-inspector-title').textContent).toBe('Arquitectura de capidocs');
    expect(root.querySelectorAll('.dx-step')).toHaveLength(4);
    expect(root.querySelector('[data-action="steps"]').disabled).toBe(false);
  });

  it('shows the selected node in the inspector and follows its drill-down', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/architecture/compiler');
    expect(root.querySelector('.dx-inspector-title').textContent.trim()).toBe('@capidocs/compiler');
    const sections = [...root.querySelectorAll('.dx-section-label')].map((label) => label.textContent);
    expect(sections).toContain('Entradas');
    expect(sections).toContain('Salidas');
    root.querySelector('[data-action="open-detail"]').click();
    await tick();
    expect(window.location.hash).toBe('#/d/publish-pipeline');
    expect(explorer.viewer.diagram.id).toBe('publish-pipeline');
    expect(explorer.viewer.trail).toEqual(['architecture', 'publish-pipeline']);
  });

  it('imports a file after confirmation, stores it locally and can forget it', async () => {
    services.importDiagramFile.mockResolvedValue({ ok: true, set: sample, warnings: [{ code: 'skipped', detail: 'x' }], format: 'json' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    explorer = mountExplorer(root, { set: demo, storages, services });
    await explorer.importText('tienda.json', JSON.stringify(sample));
    expect(services.importDiagramFile).toHaveBeenCalledWith({ name: 'tienda.json', text: JSON.stringify(sample) });
    const dialog = root.querySelector('dialog');
    expect(dialog.textContent).toContain('Hay 3 diagramas listos para importar.');
    expect(dialog.textContent).toContain('Un elemento no se pudo convertir y se omitió.');
    expect(dialog.querySelector('[data-remember]').checked).toBe(false);
    dialog.querySelector('[data-dialog="merge"]').click();
    expect(storages.session.getItem(STORAGE_KEY)).toBeNull();
    await tick();
    expect(explorer.set.diagrams).toHaveLength(demo.diagrams.length + 3);
    const record = JSON.parse(storages.session.getItem(STORAGE_KEY));
    expect(record.set.diagrams).toHaveLength(demo.diagrams.length + 3);
    expect(record).toMatchObject({ remember: false, verified: true });
    expect(storages.local.getItem(STORAGE_KEY)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await go('#/');
    storages.local.setItem(HANDOFF_KEY, '{}');
    storages.local.setItem(THEME_KEY, 'dark');
    root.querySelector('[data-action="forget"]').click();
    for (const area of [storages.session, storages.local]) {
      for (const key of [STORAGE_KEY, HANDOFF_KEY, THEME_KEY]) expect(area.getItem(key)).toBeNull();
    }
  });

  it('remembers an import for thirty days only when asked to', async () => {
    services.importDiagramFile.mockResolvedValue({ ok: true, set: sample, warnings: [] });
    explorer = mountExplorer(root, { set: demo, storages, services });
    await explorer.importText('tienda.json', JSON.stringify(sample));
    const dialog = root.querySelector('dialog');
    expect(dialog.querySelector('.dx-privacy').textContent).toContain('no salen de tu navegador');
    dialog.querySelector('[data-remember]').checked = true;
    dialog.querySelector('[data-dialog="replace"]').click();
    await tick();
    const record = JSON.parse(storages.local.getItem(STORAGE_KEY));
    expect(record).toMatchObject({ remember: true, verified: true });
    expect(storages.session.getItem(STORAGE_KEY)).toBeNull();
    expect(readSavedRecord(storages)?.area).toBe('local');
    const expired = Date.parse(record.savedAt) + (REMEMBER_DAYS + 1) * 86400000;
    expect(readSavedRecord(storages, expired)).toBeNull();
    expect(storages.local.getItem(STORAGE_KEY)).toBeNull();
  });

  it('drops the unexpiring record left by earlier versions', () => {
    storages.local.setItem('capidocs.diagrams.set.v1', JSON.stringify({ set: sample }));
    expect(readSavedRecord(storages)).toBeNull();
    expect(storages.local.getItem('capidocs.diagrams.set.v1')).toBeNull();
  });

  it('never keeps a record that is not marked as remembered in local storage', () => {
    storages.local.setItem(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), set: { title: 'x' } }));
    expect(readSavedRecord(storages)).toBeNull();
    storages.local.setItem(STORAGE_KEY, 'no es json');
    expect(readSavedRecord(storages)).toBeNull();
    clearSavedData(storages);
    expect(storages.local.getItem(STORAGE_KEY)).toBeNull();
  });

  it('turns import failures into friendly messages', async () => {
    services.importDiagramFile.mockResolvedValue({ ok: false, error: { code: 'invalid_json', detail: 'Unexpected token } in JSON at position 4' } });
    explorer = mountExplorer(root, { set: demo, storages, services });
    await explorer.importText('roto.json', '{ "a": }');
    const toast = root.querySelector('.dx-toast-error');
    expect(toast.textContent).toContain('El archivo no es un JSON válido. Revisa que esté completo.');
    expect(toast.textContent).not.toContain('Unexpected token');
    services.importDiagramFile.mockRejectedValue(new Error('boom'));
    await explorer.importText('raro.mmd', 'graph TD');
    expect(root.querySelectorAll('.dx-toast-error')[1].textContent).toContain('No se pudo leer el diagrama');
  });

  it('leaves editable data out of exports unless asked for', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/overview');
    const toggle = root.querySelector('[data-action="include-data"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    root.querySelector('[data-action="export"][data-kind="svg"]').click();
    await tick(20);
    expect(await services.downloadBlob.mock.calls[0][0].text()).not.toContain('<metadata');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    root.querySelector('[data-action="export"][data-kind="svg"]').click();
    await tick(20);
    expect(await services.downloadBlob.mock.calls[1][0].text()).toContain('id="capidocs-diagram"');
    root.querySelector('[data-action="export"][data-kind="png"][data-scale="1"]').click();
    await tick(20);
    expect(services.svgToRaster.mock.calls[0][0]).not.toContain('<metadata');
  });

  it('shows where an external link goes', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/architecture/pages');
    const link = root.querySelector('.dx-link-out');
    expect(link.getAttribute('title')).toBe('https://pages.cloudflare.com/');
    expect(link.querySelector('.dx-link-host').textContent).toBe('pages.cloudflare.com');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(linkDestination('mailto:equipo@example.com')).toBe('equipo@example.com');
    expect(linkDestination('#local')).toBe('');
  });

  it('survives languages that are not valid locales', () => {
    expect(safeLocale('x')).toBe('es');
    expect(safeLocale('en-us')).toBe('en-US');
    explorer = mountExplorer(root, { set: { ...demo, lang: 'x' }, storages, services });
    expect(root.querySelector('.dx-cat-link')).not.toBeNull();
  });

  it('exports images with embedded fonts and the set as JSON', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/overview');
    root.querySelector('[data-action="export"][data-kind="png"][data-scale="3"]').click();
    await tick(20);
    expect(services.svgToRaster).toHaveBeenCalledTimes(1);
    const [svg, options] = services.svgToRaster.mock.calls[0];
    expect(svg).toContain('@font-face');
    expect(options).toMatchObject({ scale: 3, type: 'image/png' });
    expect(services.downloadBlob.mock.calls[0][1]).toBe('overview@3x.png');
    root.querySelector('[data-action="export"][data-kind="json"]').click();
    await tick(20);
    const [blob, name] = services.downloadBlob.mock.calls[1];
    expect(name).toBe('diagramas-de-capidocs.json');
    expect(JSON.parse(await blob.text()).diagrams).toHaveLength(demo.diagrams.length);
  });

  it('builds a multipage PDF with a text layer', async () => {
    explorer = mountExplorer(root, { set: demo, storages, services });
    await go('#/d/overview');
    root.querySelector('[data-action="export"][data-kind="pdf-all"]').click();
    await tick(50);
    const [pages, options] = services.buildPdf.mock.calls[0];
    expect(pages).toHaveLength(demo.diagrams.length);
    expect(options.title).toBe(demo.title);
    for (const page of pages) {
      expect(page.jpeg).toBeInstanceOf(Uint8Array);
      expect(page.imageWidth).toBe(Math.round(page.width * 2));
      expect(page.texts.length).toBeGreaterThan(3);
    }
  });
});
