import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { mountDiagram } from '../../assets/js/diagram/viewer.js';

const siteDir = join(import.meta.dirname, '../..');
const sample = validateDiagramSet(JSON.parse(readFileSync(join(siteDir, 'test/fixtures/diagrams/sample.json'), 'utf8'))).set;

function pointer(type, target, init = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10, ...init }));
}

function click(target) {
  pointer('pointerdown', target);
  pointer('pointerup', target);
}

function key(target, name, init = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
}

describe('mountDiagram', () => {
  let host;
  let viewer;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    viewer?.destroy();
    viewer = null;
    host.remove();
  });

  it('renders the requested diagram with accessible chrome', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    const viewport = host.querySelector('.dg-viewport');
    expect(viewport.getAttribute('role')).toBe('application');
    expect(viewport.getAttribute('aria-label')).toBe('Diagrama: Panorama del sistema');
    expect(host.querySelectorAll('[data-node]').length).toBe(viewer.scene.nodes.length);
    expect(host.querySelector('.dg-zoom [aria-label="Acercar"]')).not.toBeNull();
    expect(host.querySelector('.dg-viewer').dataset.dgTheme).toBe('light');
    expect(host.innerHTML).not.toMatch(/<script/i);
  });

  it('selects a node on click and reports it', () => {
    const onSelect = vi.fn();
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light', onSelect });
    click(host.querySelector('[data-node="api"] .dg-node-bg'));
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'node', id: 'api', diagram: 'overview' });
    expect(host.querySelector('[data-node="api"]').classList.contains('dg-selected')).toBe(true);
    click(host.querySelector('.dg-viewport'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('expands a card from its chevron and collapses a group from its chip', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    const before = viewer.scene.nodes.find((node) => node.id === 'web').h;
    click(host.querySelector('[data-action="toggle-expand"][data-target="web"]'));
    expect(viewer.scene.nodes.find((node) => node.id === 'web').h).toBeGreaterThan(before);
    expect(host.querySelector('[data-node="web"]').getAttribute('aria-expanded')).toBe('true');
    click(host.querySelector('.dg-group-chip[data-group="data"]'));
    expect(viewer.isCollapsed('data')).toBe(true);
    expect(host.querySelector('[data-node="orders"]')).toBeNull();
  });

  it('zooms, fits and pans from the keyboard', async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    const viewport = host.querySelector('.dg-viewport');
    const start = viewer.camera.k;
    key(viewport, '+');
    await settle();
    expect(viewer.camera.k).toBeGreaterThan(start);
    key(viewport, '0');
    await settle();
    expect(viewer.camera.k).toBeCloseTo(1, 5);
    const x = viewer.camera.x;
    key(viewport, 'ArrowLeft');
    expect(viewer.camera.x).toBeGreaterThan(x);
    key(viewport, 'f');
    expect(host.querySelector('.dg-camera').getAttribute('transform')).toMatch(/^translate\([-\d.]+ [-\d.]+\) scale\([\d.]+\)$/);
  });

  it('moves focus between nodes with the arrows and opens links with Enter', () => {
    const onNavigate = vi.fn();
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light', onNavigate });
    const viewport = host.querySelector('.dg-viewport');
    viewer.focusNode('buyer');
    expect(document.activeElement.dataset.node).toBe('buyer');
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement.dataset.node).not.toBe('buyer');
    viewer.focusNode('web');
    key(document.activeElement, 'Enter');
    expect(onNavigate).toHaveBeenCalledWith({ diagram: 'checkout', node: undefined, from: 'overview' });
    key(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(viewport);
  });

  it('drills down into linked diagrams and keeps a trail', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    click(host.querySelector('[data-action="open-link"][data-target="web"]'));
    expect(viewer.diagram.id).toBe('checkout');
    expect(viewer.trail).toEqual(['overview', 'checkout']);
    const trail = host.querySelector('.dg-trail');
    expect(trail.hidden).toBe(false);
    trail.querySelector('[data-viewer-action="trail"]').click();
    expect(viewer.diagram.id).toBe('overview');
  });

  it('opens external links in a new tab without an opener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    viewer.navigate({ href: 'https://example.com/' });
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('plays steps and highlights what each one touches', () => {
    const onStep = vi.fn();
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light', onStep });
    viewer.steps.start();
    const root = host.querySelector('.dg-viewer');
    expect(root.classList.contains('dg-step-mode')).toBe(true);
    expect(host.querySelector('.dg-player').hidden).toBe(false);
    expect(host.querySelector('.dg-player-count').textContent).toBe('1 de 3');
    expect(host.querySelector('[data-node="buyer"]').classList.contains('dg-step')).toBe(true);
    expect(host.querySelector('[data-node="api"]').classList.contains('dg-step')).toBe(false);
    host.querySelector('[data-viewer-action="step-next"]').click();
    expect(viewer.steps.index).toBe(1);
    expect(onStep).toHaveBeenLastCalledWith(1);
    key(host.querySelector('.dg-viewport'), 'Escape');
    expect(root.classList.contains('dg-step-mode')).toBe(false);
  });

  it('filters by tag and finds nodes by name', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    viewer.setFilter({ tags: ['backend'] });
    expect(host.querySelector('.dg-viewer').classList.contains('dg-filter-mode')).toBe(true);
    expect(host.querySelector('[data-node="api"]').classList.contains('dg-match')).toBe(true);
    expect(host.querySelector('[data-node="buyer"]').classList.contains('dg-match')).toBe(false);
    expect(viewer.search('pasarela').map((result) => result.id)).toEqual(['payments']);
  });

  it('highlights neighbours on hover', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'light' });
    pointer('pointermove', host.querySelector('[data-node="api"] .dg-node-bg'), { pointerType: 'mouse' });
    const event = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    host.querySelector('[data-node="api"] .dg-node-bg').dispatchEvent(event);
    expect(host.querySelector('.dg-viewer').classList.contains('dg-hover-mode')).toBe(true);
    expect(host.querySelector('[data-node="web"]').classList.contains('dg-hl')).toBe(true);
    expect(host.querySelector('[data-node="buyer"]').classList.contains('dg-hl')).toBe(false);
  });

  it('exports the current state as a standalone SVG', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'overview', theme: 'dark' });
    viewer.toggleExpand('web');
    const svg = viewer.toSvg({ embedFontCss: '' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Peticiones por minuto');
    expect(svg).not.toContain('<metadata');
    expect(svg).not.toMatch(/\sstyle=/);
    expect(viewer.toSvg({ embedFontCss: '', metadata: true })).toContain('id="capidocs-diagram"');
  });

  it('cleans up after itself', () => {
    viewer = mountDiagram(host, { set: sample, diagramId: 'checkout', theme: 'light' });
    expect(host.querySelectorAll('[data-message]').length).toBe(viewer.scene.messages.length);
    viewer.destroy();
    viewer = null;
    expect(host.children).toHaveLength(0);
  });
});
