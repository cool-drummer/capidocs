import { afterEach, describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { layoutDiagram } from '../../assets/js/diagram/layout/index.js';
import { renderSvg, iconMarkup } from '../../assets/js/diagram/render/svg.js';
import { colorOf, statusColor, themeTokens } from '../../assets/js/diagram/theme.js';
import { BUILTIN_ICONS } from '../../assets/js/diagram/icons.js';
import { createDiagramTranslator, resolveLang } from '../../assets/js/diagram/i18n.js';
import { icon } from '../../assets/js/diagram/explorer.js';
import { mountDiagram } from '../../assets/js/diagram/viewer.js';

const NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

function inherited() {
  return JSON.parse('{"__proto__": {"paths": "nope"}, "constructor": {"viewBox": "0 0 24 24", "paths": ["M1 1h2"], "stroke": true}, "toString": 5}');
}

function prototypeSet() {
  const result = validateDiagramSet({
    title: 'Prototipo',
    diagrams: [{
      id: 'toLocaleString',
      title: 'Prototipo',
      groups: [{ id: 'toString', title: 'Grupo' }],
      nodes: [
        { id: 'hasOwnProperty', title: 'Uno', group: 'toString' },
        { id: 'valueOf', title: 'Dos', group: 'toString' },
        { id: 'isPrototypeOf', title: 'Tres', shape: 'table', fields: [{ name: 'id', key: 'pk' }] },
      ],
      edges: [
        { id: 'propertyIsEnumerable', from: 'hasOwnProperty', to: 'valueOf', label: 'toString' },
        { from: 'valueOf', to: 'isPrototypeOf' },
      ],
    }],
  });
  if (!result.ok) return null;
  result.set.diagrams[0].groups[0].icon = 'constructor';
  result.set.diagrams[0].nodes[0].icon = 'constructor';
  result.set.diagrams[0].nodes[1].icon = 'toString';
  return result.set;
}

describe('prototype-named catalog entries', () => {
  let host;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  it('keeps the built-in icon catalog free of inherited names', () => {
    for (const name of NAMES) expect(Object.hasOwn(BUILTIN_ICONS, name), name).toBe(false);
    expect(Object.getPrototypeOf(BUILTIN_ICONS)).toBeNull();
    expect(Object.isFrozen(BUILTIN_ICONS)).toBe(true);
  });

  it('draws nothing for icons named after Object members', () => {
    const scene = { kind: 'graph', width: 100, height: 100, lanes: [], groups: [], edges: [], nodes: [] };
    const set = { icons: inherited() };
    for (const name of NAMES) {
      expect(icon(name)).toBe('');
      const svg = renderSvg(scene, { set });
      expect(svg).not.toContain('function');
    }
    const ctx = { icons: Object.assign(Object.create(null), BUILTIN_ICONS), tokens: themeTokens('light') };
    for (const name of NAMES) expect(iconMarkup(ctx, name, { x: 0, y: 0, size: 16, color: '#000' })).toBe('');
  });

  it('lays out and renders ids, icons and labels named after Object members', () => {
    const set = prototypeSet();
    expect(set).not.toBeNull();
    const diagram = set.diagrams[0];
    const scene = layoutDiagram(diagram);
    expect(scene.nodes.map((node) => node.id)).toEqual(['hasOwnProperty', 'valueOf', 'isPrototypeOf']);
    for (const mode of ['interactive', 'export']) {
      const svg = renderSvg(scene, { mode, set: { ...set, icons: inherited() }, diagram });
      expect(svg).toContain('data-node="hasOwnProperty"');
      expect(svg).toContain('data-group="toString"');
      expect(svg).not.toMatch(/function |\[object/);
    }
  });

  it('falls back to neutral colors and default translations', () => {
    const tokens = themeTokens('dark');
    for (const name of NAMES) {
      expect(colorOf(tokens, name)).toBe(tokens.colors.neutral);
      expect(statusColor(name)).toBe('neutral');
      expect(resolveLang(name)).toBe('es');
    }
    const t = createDiagramTranslator('constructor');
    expect(t('viewer.zoomIn')).toBe('Acercar');
    expect(t('toString')).toBe('toString');
    expect(t('steps.counter', { current: 1, total: 2, constructor: 3 })).toBe('1 de 2');
    expect(themeTokens('light', JSON.parse('{"__proto__": {"light": "#000000"}}')).accent).toBe('#2f8f90');
  });

  it('mounts a viewer on the same diagram and selects those nodes', () => {
    const set = prototypeSet();
    host = document.createElement('div');
    document.body.appendChild(host);
    const viewer = mountDiagram(host, { set, diagramId: 'toLocaleString', theme: 'light' });
    viewer.select({ type: 'node', id: 'hasOwnProperty' });
    expect(host.querySelector('[data-node="hasOwnProperty"]').classList.contains('dg-selected')).toBe(true);
    expect(viewer.search('dos').map((entry) => entry.id)).toEqual(['valueOf']);
    viewer.destroy();
  });
});
