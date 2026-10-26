import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDiagramSetJson, validateDiagramSet } from '../../assets/js/diagram/model.js';
import { layoutDiagram } from '../../assets/js/diagram/layout/index.js';
import { METADATA_ID, renderSvg, sceneTexts } from '../../assets/js/diagram/render/svg.js';
import { fontFaceCss, setExportFontCss } from '../../assets/js/diagram/render/fonts.js';

const siteDir = join(import.meta.dirname, '../..');
const sample = validateDiagramSet(JSON.parse(readFileSync(join(siteDir, 'test/fixtures/diagrams/sample.json'), 'utf8'))).set;
const demo = validateDiagramSet(JSON.parse(readFileSync(join(siteDir, 'config/diagrams/capidocs.json'), 'utf8'))).set;

const EVIL = '<script>alert(1)</script>"><img src=x onerror=alert(1)>';

function hostileSet() {
  const result = validateDiagramSet({
    title: EVIL,
    categories: [{ id: 'c', title: 'Categoría' }],
    diagrams: [
      {
        id: 'graph',
        title: EVIL,
        category: 'c',
        lanes: [{ id: 'lane', title: EVIL }],
        groups: [{ id: 'group', title: EVIL }],
        nodes: [
          { id: 'n1', title: EVIL, subtitle: EVIL, badge: EVIL.slice(0, 40), lane: 'lane', group: 'group', props: [{ label: EVIL, value: EVIL }], expanded: true, link: { href: 'https://example.com/?q=1&r=2' } },
          { id: 'n2', title: EVIL, shape: 'table', lane: 'lane', fields: [{ name: EVIL, type: EVIL }] },
          { id: 'n3', title: EVIL, shape: 'note', description: EVIL, lane: 'lane' },
          { id: 'n4', title: EVIL, shape: 'tile', lane: 'lane' },
        ],
        edges: [{ from: 'n1', to: 'n2', label: EVIL.slice(0, 80) }],
      },
      {
        id: 'sequence',
        title: EVIL,
        category: 'c',
        kind: 'sequence',
        participants: [{ id: 'a', title: EVIL, subtitle: EVIL }, { id: 'b', title: EVIL }],
        items: [
          { from: 'a', to: 'b', label: EVIL },
          { type: 'note', over: ['a'], text: EVIL },
          { type: 'block', kind: 'loop', label: EVIL, items: [{ from: 'b', to: 'a', label: EVIL }], branches: [{ label: EVIL, items: [] }] },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.set;
}

function parse(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

const everyScene = (set) => set.diagrams.map((diagram) => ({ diagram, scene: layoutDiagram(diagram) }));

describe('renderSvg', () => {
  it('escapes every piece of text from the model', () => {
    const set = hostileSet();
    for (const { scene } of everyScene(set)) {
      for (const mode of ['interactive', 'export']) {
        const svg = renderSvg(scene, { mode, set, title: EVIL });
        expect(svg).not.toMatch(/<script/i);
        expect(svg).not.toMatch(/<img/i);
        const doc = parse(svg);
        expect(doc.querySelectorAll('script, img, foreignObject, iframe')).toHaveLength(0);
        for (const element of doc.querySelectorAll('*')) {
          for (const attribute of element.attributes) expect(attribute.name.startsWith('on'), attribute.name).toBe(false);
        }
        expect(doc.documentElement.textContent).toContain('<script>alert(1)</script>');
      }
    }
  });

  it('never emits inline style attributes', () => {
    for (const set of [sample, demo, hostileSet()]) {
      for (const { scene } of everyScene(set)) {
        for (const mode of ['interactive', 'export']) {
          const svg = renderSvg(scene, { mode, set, theme: mode === 'export' ? 'dark' : 'light', embedFontCss: '@font-face{font-family:"Geist"}' });
          expect(svg).not.toMatch(/\sstyle=/);
        }
      }
    }
  });

  it('tags every element with its model id', () => {
    for (const { diagram, scene } of everyScene(sample)) {
      const doc = parse(renderSvg(scene, { set: sample }));
      if (scene.kind === 'graph') {
        for (const node of scene.nodes) expect(doc.querySelector(`[data-node="${node.id}"]`), node.id).not.toBeNull();
        for (const edge of scene.edges) expect(doc.querySelector(`[data-edge="${edge.id}"]`), edge.id).not.toBeNull();
        for (const group of scene.groups) expect(doc.querySelector(`[data-group="${group.id}"]`), group.id).not.toBeNull();
        for (const lane of scene.lanes) expect(doc.querySelector(`[data-lane="${lane.id}"]`), lane.id).not.toBeNull();
      } else {
        for (const participant of diagram.participants) expect(doc.querySelector(`[data-node="${participant.id}"]`)).not.toBeNull();
        for (const message of scene.messages) expect(doc.querySelector(`[data-message="${message.id}"]`)).not.toBeNull();
        expect(doc.querySelectorAll('[data-block]')).toHaveLength(scene.blocks.length);
      }
    }
  });

  it('makes nodes reachable and labelled only in interactive mode', () => {
    const scene = layoutDiagram(sample.diagrams[0]);
    const interactive = parse(renderSvg(scene, { set: sample }));
    const web = interactive.querySelector('[data-node="web"]');
    expect(web.getAttribute('role')).toBe('button');
    expect(web.getAttribute('aria-label')).toBe('Sitio web, apps/web');
    expect(web.getAttribute('aria-expanded')).toBe('false');
    expect(interactive.querySelector('[data-action="toggle-expand"][data-target="web"]')).not.toBeNull();
    const exported = parse(renderSvg(scene, { mode: 'export', set: sample }));
    expect(exported.querySelector('[role="button"], [tabindex], [data-action]')).toBeNull();
  });

  it('paints the export with concrete colors, a background and embedded fonts', () => {
    const scene = layoutDiagram(sample.diagrams[0]);
    const svg = renderSvg(scene, { mode: 'export', theme: 'dark', set: sample, embedFontCss: '<style>@font-face{font-family:"Geist";src:url(data:font/woff2;base64,AAAA)}</style>' });
    const doc = parse(svg);
    expect(doc.querySelector('svg > rect').getAttribute('fill')).toBe('#111113');
    expect(doc.querySelector('style').textContent).toContain('@font-face');
    expect(svg).not.toMatch(/<style><style/);
    expect(svg).not.toContain('var(--');
  });

  it('falls back to the registered fonts when none are passed', () => {
    setExportFontCss(fontFaceCss('Geist', new Uint8Array([1, 2, 3])));
    try {
      const svg = renderSvg(layoutDiagram(sample.diagrams[0]), { mode: 'export', set: sample });
      expect(svg).toContain('font-family:"Geist";src:url(data:font/woff2;base64,AQID)');
      expect(renderSvg(layoutDiagram(sample.diagrams[0]), { mode: 'interactive', set: sample })).not.toContain('@font-face');
    } finally {
      setExportFontCss('');
    }
  });

  it('carries the diagram as metadata so the export can be imported again', () => {
    const diagram = sample.diagrams[2];
    const svg = renderSvg(layoutDiagram(diagram), { mode: 'export', set: sample, diagram });
    const doc = parse(svg);
    const metadata = doc.getElementById(METADATA_ID);
    expect(metadata).not.toBeNull();
    const result = parseDiagramSetJson(metadata.textContent);
    expect(result.ok).toBe(true);
    expect(result.set.diagrams.map((entry) => entry.id)).toEqual([diagram.id]);
    expect(result.set.start).toBe(diagram.id);
  });

  it('paints brand icons with their own color and custom icons from the set', () => {
    const architecture = demo.diagrams.find((diagram) => diagram.id === 'architecture');
    const svg = renderSvg(layoutDiagram(architecture), { mode: 'export', set: demo, theme: 'light' });
    expect(svg).toContain('fill="#F38020"');
    const custom = renderSvg(layoutDiagram(sample.diagrams[0]), { mode: 'export', set: sample });
    expect(custom).toContain('M3 9l2-5h14l2 5');
  });
});

describe('sceneTexts', () => {
  it('lists every visible text with a baseline inside the scene', () => {
    for (const { scene } of [...everyScene(sample), ...everyScene(demo)]) {
      const texts = sceneTexts(scene);
      expect(texts.length).toBeGreaterThan(3);
      for (const entry of texts) {
        expect(entry.x).toBeGreaterThanOrEqual(-1);
        expect(entry.y).toBeGreaterThan(0);
        expect(entry.x).toBeLessThanOrEqual(scene.width);
        expect(entry.y).toBeLessThanOrEqual(scene.height);
        expect(entry.size).toBeGreaterThan(8);
        expect(entry.width).toBeGreaterThan(0);
      }
    }
  });

  it('places node titles at absolute coordinates', () => {
    const scene = layoutDiagram(sample.diagrams[0]);
    const api = scene.nodes.find((node) => node.id === 'api');
    const title = sceneTexts(scene).find((entry) => entry.text === 'API');
    expect(title.x).toBeGreaterThan(api.x);
    expect(title.x).toBeLessThan(api.x + api.w);
    expect(title.y).toBeGreaterThan(api.y);
    expect(title.y).toBeLessThan(api.y + api.h);
  });
});
