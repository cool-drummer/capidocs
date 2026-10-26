import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../assets/js/diagram/model.js';
import { parseDrawio } from '../assets/js/diagram/import/drawio.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'diagrams');
const plain = readFileSync(join(fixtures, 'library.drawio'), 'utf8');
const packed = readFileSync(join(fixtures, 'library-compressed.drawio'), 'utf8');
const extra = (process.env.CAPIDOCS_EXTRA_DRAWIO ?? '').split(':').filter(Boolean);

function pack(xml) {
  return deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
}

function page(cells, name = 'Página') {
  return `<mxfile><diagram name="${name}" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
}

async function load(text, options = {}) {
  const { set, warnings } = await parseDrawio(text, { title: 'file', ...options });
  const result = validateDiagramSet(set);
  expect(result.issues).toEqual([]);
  return { set: result.set, warnings };
}

describe('draw.io import', () => {
  it('imports every page of the synthetic fixture', async () => {
    const { set, warnings } = await load(plain);
    expect(set.title).toBe('file');
    expect(set.diagrams.map((diagram) => [diagram.id, diagram.title, diagram.kind])).toEqual([
      ['arch-1', 'Arquitectura de préstamos', 'graph'],
      ['seq-2', 'Secuencia de préstamo', 'sequence']
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['skipped_shapes', 'unsafe_link', 'dangling_edge', 'empty_page']));
  });

  it('maps shapes, containers, colors, text and links', async () => {
    const { set } = await load(plain);
    const graph = set.diagrams[0];
    const node = (id) => graph.nodes.find((entry) => entry.id === id);
    expect(graph.description).toBe('Sistema de préstamos de la biblioteca');
    expect(graph.groups.map((group) => [group.id, group.title, group.color])).toEqual([['services', 'Servicios', 'violet']]);
    expect(node('reader').shape).toBe('actor');
    expect([node('api').title, node('api').subtitle, node('api').color, node('api').group]).toEqual(['API de préstamos', 'Node 22', 'blue', 'services']);
    expect([node('catalog').title, node('catalog').subtitle]).toEqual(['Catálogo', 'Búsqueda por título']);
    expect(JSON.stringify(graph)).not.toMatch(/<script|<b>|alert/);
    expect([node('decision').shape, node('decision').color]).toEqual(['diamond', 'amber']);
    expect([node('db').shape, node('db').color, node('db').group]).toEqual(['cylinder', 'green', undefined]);
    expect(node('queue').shape).toBe('circle');
    expect(node('panel').link).toEqual({ href: 'https://example.com/panel' });
    expect(node('panel').description).toBe('Panel de control');
    expect(node('panel').props).toEqual([{ label: 'owner', value: 'Equipo web', mono: false }]);
    expect(node('panel').tags).toEqual(['interno', 'web']);
    expect(node('unsafe').link).toBeUndefined();
    expect(node('jump').link).toEqual({ diagram: 'seq-2' });
    expect(node('jump').shape).toBe('note');
    expect(node('footer').shape).toBe('text');
    expect(node('decor')).toBeUndefined();
    expect(node('title')).toBeUndefined();
    expect(node('rule')).toBeUndefined();
    expect([node('api').x, node('api').y, node('api').w, node('api').h]).toEqual([180, 120, 140, 60]);
  });

  it('maps edges with labels, styles, arrows, waypoints and snapped ends', async () => {
    const { set } = await load(plain);
    const edges = set.diagrams[0].edges.map((edge) => ({ from: edge.from, to: edge.to, label: edge.label, style: edge.style, arrow: edge.arrow, points: edge.points.length }));
    expect(edges).toEqual([
      { from: 'reader', to: 'api', label: 'Solicita', style: 'solid', arrow: 'end', points: 0 },
      { from: 'api', to: 'db', label: undefined, style: 'dashed', arrow: 'none', points: 0 },
      { from: 'api', to: 'decision', label: 'consulta', style: 'thick', arrow: 'both', points: 2 },
      { from: 'catalog', to: 'queue', label: 'Notifica', style: 'solid', arrow: 'end', points: 0 },
      { from: 'catalog', to: 'services', label: undefined, style: 'solid', arrow: 'end', points: 0 }
    ]);
  });

  it('reads a lifeline page as a sequence diagram', async () => {
    const { set } = await load(plain);
    const sequence = set.diagrams[1];
    expect(sequence.description).toBe('Cómo se presta un libro');
    expect(sequence.participants.map((participant) => [participant.title, participant.kind])).toEqual([
      ['Lector', 'actor'], ['Mostrador', 'system'], ['Catálogo', 'store']
    ]);
    expect(sequence.items.map((item) => (item.type === 'message' ? `${item.from}>${item.to}:${item.style}:${item.label}` : `note:${item.over.join(',')}`))).toEqual([
      'l1>l2:sync:Pide un libro', 'l2>l3:async:Consulta existencias', 'l3>l2:reply:Disponible', 'note:l2'
    ]);
  });

  it('gives the same result for compressed and uncompressed files', async () => {
    const a = await load(plain);
    const b = await load(packed);
    expect(b.set).toEqual(a.set);
  });

  it('drops coordinates with the automatic layout option', async () => {
    const { set } = await load(plain, { layout: 'auto' });
    const graph = set.diagrams[0];
    expect(graph.nodes.every((node) => node.x === undefined && node.w === undefined)).toBe(true);
    expect(graph.groups.every((group) => group.x === undefined)).toBe(true);
    expect(graph.edges.every((edge) => edge.points.length === 0)).toBe(true);
  });

  it('ignores DOCTYPE entities inside the document', async () => {
    const hostile = `<?xml version="1.0"?><!DOCTYPE mxfile [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>${page('<mxCell id="n" value="&xxe;&b;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>')}`;
    const { set } = await load(hostile);
    expect(set.diagrams[0].nodes[0].title).toBe('&xxe;&b;');
  });

  it('rejects decompression bombs and broken payloads', async () => {
    const bomb = `<mxfile><diagram name="x" id="x">${deflateRawSync(Buffer.alloc(40 * 1024 * 1024, 0x41)).toString('base64')}</diagram></mxfile>`;
    await expect(parseDrawio(bomb)).rejects.toMatchObject({ code: 'too_large' });
    await expect(parseDrawio('<mxfile><diagram name="x" id="x">!!!not-base64!!!</diagram></mxfile>')).rejects.toMatchObject({ code: 'parse_error' });
    const garbage = `<mxfile><diagram name="x" id="x">${Buffer.from('not deflate data at all').toString('base64')}</diagram></mxfile>`;
    await expect(parseDrawio(garbage)).rejects.toMatchObject({ code: 'parse_error' });
    await expect(parseDrawio('<mxfile><diagram><mxGraphModel></diagram></mxfile>')).rejects.toMatchObject({ code: 'parse_error' });
    await expect(parseDrawio('<root/>')).rejects.toMatchObject({ code: 'unsupported_format' });
    await expect(parseDrawio(page(''))).rejects.toMatchObject({ code: 'empty' });
  });

  it('survives parent cycles and very long parent chains', async () => {
    const chain = Array.from({ length: 3000 }, (_, index) => `<mxCell id="c${index}" value="Caja ${index}" style="swimlane" vertex="1" parent="${index === 0 ? '1' : `c${index - 1}`}"><mxGeometry x="1" y="1" width="50" height="50" as="geometry"/></mxCell>`).join('');
    const cycle = '<mxCell id="x" value="X" vertex="1" parent="y"><mxGeometry width="10" height="10" as="geometry"/></mxCell><mxCell id="y" value="Y" vertex="1" parent="x"><mxGeometry width="10" height="10" as="geometry"/></mxCell>';
    const started = performance.now();
    const { set, warnings } = await load(page(chain + cycle));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(validateDiagramSet(set).ok).toBe(true);
    expect(warnings.map((warning) => warning.code)).toContain('flattened_groups');
  });

  it('accepts a bare mxGraphModel and compressed pages built by hand', async () => {
    const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Uno" vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>';
    expect((await load(model)).set.diagrams[0].nodes[0].title).toBe('Uno');
    const { set } = await load(`<mxfile><diagram name="Comprimida" id="c">${pack(model)}</diagram></mxfile>`);
    expect(set.diagrams[0].title).toBe('Comprimida');
  });

  it('parses the same way in the browser path and the Node fallback', async () => {
    const original = globalThis.DecompressionStream;
    try {
      globalThis.DecompressionStream = undefined;
      const fallback = await parseDrawio(packed, { title: 'file' });
      globalThis.DecompressionStream = original;
      const native = await parseDrawio(packed, { title: 'file' });
      expect(fallback.set).toEqual(native.set);
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});

describe.skipIf(!extra.length)('external draw.io files (CAPIDOCS_EXTRA_DRAWIO)', () => {
  it.each(extra)('imports %s into a valid set', async (file) => {
    const { set } = await load(readFileSync(file, 'utf8'));
    expect(set.diagrams.length).toBeGreaterThan(0);
  });
});
