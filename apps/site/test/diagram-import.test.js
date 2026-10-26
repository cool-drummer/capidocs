import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../assets/js/diagram/model.js';
import { detectFormat, importDiagramFile, importDiagramText } from '../assets/js/diagram/import/index.js';
import { importMarkdown, scanMarkdown } from '../assets/js/diagram/import/markdown.js';
import { importHtml, scanHtml } from '../assets/js/diagram/import/html.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'diagrams');
const read = (name) => readFileSync(join(fixtures, name), 'utf8');

const MARKDOWN = `# Manual de la biblioteca

Diagramas que explican cómo funciona el préstamo.

## Flujo de préstamo

El lector pide un libro en el **mostrador** y espera la [confirmación](https://example.com).

\`\`\`mermaid
flowchart TD
    A[Lector] --> B[Mostrador]
\`\`\`

## Secuencia de devolución

\`\`\`mermaid
---
title: Devolución explícita
---
sequenceDiagram
    L->>M: Devuelve el libro
\`\`\`

### Detalle

\`\`\`json
{ "retries": 3 }
\`\`\`

~~~capidocs-diagram
{ "id": "stock", "title": "Inventario", "nodes": [{ "id": "shelf", "title": "Estante" }] }
~~~

\`\`\`capidocs-diagram
{ not json
\`\`\`

\`\`\`mermaid
pie title No soportado
\`\`\`

    \`\`\`mermaid
    indented code is not a fence
    \`\`\`
`;

describe('format detection', () => {
  it('detects by extension first and by content otherwise', () => {
    expect(detectFormat('{}', 'a.json')).toBe('json');
    expect(detectFormat('', 'a.MMD')).toBe('mermaid');
    expect(detectFormat('', 'a.drawio')).toBe('drawio');
    expect(detectFormat('', 'a.xml')).toBe('drawio');
    expect(detectFormat('', 'a.htm')).toBe('html');
    expect(detectFormat('', 'a.markdown')).toBe('markdown');
    expect(detectFormat('', 'a.drawio.svg')).toBe('svg');
    expect(detectFormat('  {"diagrams": []}', '')).toBe('json');
    expect(detectFormat('<?xml version="1.0"?>\n<mxfile>', 'x.txt')).toBe('drawio');
    expect(detectFormat('<!doctype html><html>', '')).toBe('html');
    expect(detectFormat('<svg xmlns="http://www.w3.org/2000/svg"></svg>', '')).toBe('svg');
    expect(detectFormat('Texto\n```mermaid\ngraph TD\n```', '')).toBe('markdown');
    expect(detectFormat('%% comentario\ngraph TD\nA-->B', '')).toBe('mermaid');
    expect(detectFormat('sequenceDiagram\nA->>B: x', 'notes.txt')).toBe('mermaid');
    expect(detectFormat('erDiagram\nA ||--o{ B : x', '')).toBe('mermaid');
    expect(detectFormat('# Título\n\ntexto', '')).toBe('markdown');
    expect(detectFormat('just some words', '')).toBeUndefined();
  });
});

describe('importDiagramFile', () => {
  it('imports the native model and wraps a single diagram or a list', async () => {
    const set = await importDiagramFile({ name: 'sample.json', text: read('sample.json') });
    expect(set.ok).toBe(true);
    expect(set.set.diagrams).toHaveLength(3);
    const single = await importDiagramFile({ name: 'mapa.json', text: JSON.stringify({ title: 'Mapa', nodes: [{ id: 'a', title: 'A' }] }) });
    expect(single.ok).toBe(true);
    expect(single.set.title).toBe('mapa');
    expect(single.set.diagrams[0].id).toBe('mapa');
    const list = await importDiagramText(JSON.stringify([{ title: 'Uno', nodes: [{ id: 'a', title: 'A' }] }, { id: 'uno', title: 'Dos', nodes: [{ id: 'b', title: 'B' }] }]));
    expect(list.ok).toBe(true);
    expect(list.set.diagrams.map((diagram) => diagram.id)).toEqual(['uno-2', 'uno']);
  });

  it('returns stable error codes without throwing', async () => {
    expect(await importDiagramFile({ name: 'a.json', text: '   ' })).toMatchObject({ ok: false, error: { code: 'empty' } });
    expect(await importDiagramFile({ name: 'a.json', text: '{ broken' })).toMatchObject({ ok: false, error: { code: 'invalid_json' } });
    expect(await importDiagramFile({ name: 'a.json', text: '{"hello": 1}' })).toMatchObject({ ok: false, error: { code: 'invalid_model' } });
    expect(await importDiagramFile({ name: 'a.txt', text: 'hola mundo' })).toMatchObject({ ok: false, error: { code: 'unsupported_format' } });
    expect(await importDiagramFile({ name: 'a.mmd', text: 'gantt\ntitle x' })).toMatchObject({ ok: false, error: { code: 'unsupported_format' } });
    expect(await importDiagramFile({ name: 'a.drawio', text: '<mxfile><diagram>' })).toMatchObject({ ok: false, error: { code: 'parse_error' } });
    expect(await importDiagramFile({ name: 'a.drawio', text: '<root/>' })).toMatchObject({ ok: false, error: { code: 'unsupported_format' } });
    expect(await importDiagramFile({ name: 'a.json', text: 'x'.repeat(LIMITS.fileBytes + 1) })).toMatchObject({ ok: false, error: { code: 'too_large' } });
    expect(await importDiagramFile({ name: 'a.json', text: 'é'.repeat(Math.ceil(LIMITS.fileBytes / 2) + 1) })).toMatchObject({ ok: false, error: { code: 'too_large' } });
    expect(await importDiagramFile({ name: 'a.json' })).toMatchObject({ ok: false, error: { code: 'parse_error' } });
  });

  it('reports model issues with paths, including unsafe links in native JSON', async () => {
    const result = await importDiagramFile({
      name: 'a.json',
      text: JSON.stringify({ title: 'X', diagrams: [{ id: 'd', title: 'D', nodes: [{ id: 'n', title: 'N', link: { href: 'javascript:alert(1)' } }] }] })
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('invalid_model');
    expect(result.issues).toEqual(expect.arrayContaining([{ path: 'diagrams.0.nodes.0.link.href', message: expect.stringContaining('http') }]));
  });

  it('does not pollute prototypes through JSON keys', async () => {
    const result = await importDiagramText('{"title":"x","__proto__":{"polluted":true},"diagrams":[{"id":"d","title":"D","nodes":[{"id":"n","title":"N"}]}]}');
    expect(result.ok).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it('survives deeply nested JSON', async () => {
    const deep = `{"title":"x","diagrams":[{"id":"d","title":"D","kind":"sequence","participants":[{"id":"a","title":"A"}],"items":${'[{"type":"block","items":'.repeat(5000)}[]${'}]'.repeat(5000)}}]}`;
    const result = await importDiagramText(deep, { hint: 'json' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('invalid_model');
  });

  it('honors the paste hint', async () => {
    const result = await importDiagramText('A --> B', { hint: 'mermaid' });
    expect(result.ok).toBe(false);
    const hinted = await importDiagramText('graph LR\nA --> B', { hint: 'notes.mmd' });
    expect(hinted).toMatchObject({ ok: true, format: 'mermaid' });
  });
});

describe('markdown import', () => {
  it('finds headings, paragraphs and fenced blocks', () => {
    const scan = scanMarkdown(MARKDOWN);
    expect(scan.title).toBe('Manual de la biblioteca');
    expect(scan.description).toBe('Diagramas que explican cómo funciona el préstamo.');
    expect(scan.blocks.map((block) => [block.language, block.heading?.title])).toEqual([
      ['mermaid', 'Flujo de préstamo'], ['mermaid', 'Secuencia de devolución'], ['json', 'Secuencia de devolución'],
      ['capidocs-diagram', 'Secuencia de devolución'], ['capidocs-diagram', 'Secuencia de devolución'], ['mermaid', 'Secuencia de devolución']
    ]);
  });

  it('builds one diagram per block with titles and descriptions', () => {
    const { set, warnings } = importMarkdown(MARKDOWN);
    expect(set.title).toBe('Manual de la biblioteca');
    expect(set.description).toBe('Diagramas que explican cómo funciona el préstamo.');
    expect(set.diagrams.map((diagram) => [diagram.id, diagram.title, diagram.description])).toEqual([
      ['flujo-de-prestamo', 'Flujo de préstamo', 'El lector pide un libro en el mostrador y espera la confirmación.'],
      ['devolucion-explicita', 'Devolución explícita', undefined],
      ['stock', 'Inventario', undefined]
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['invalid_block', 'invalid_block']);
  });

  it('fails cleanly when nothing can be imported', async () => {
    expect(await importDiagramFile({ name: 'a.md', text: '# Hola\n\nSin diagramas.' })).toMatchObject({ ok: false, error: { code: 'empty' } });
  });
});

describe('html import', () => {
  it('extracts mermaid blocks from pre, code and div without running anything', async () => {
    const before = document.body.innerHTML;
    const result = await importDiagramFile({ name: 'page.html', text: read('page.html') });
    expect(result.ok).toBe(true);
    expect(globalThis.__capidocsPwned).toBeUndefined();
    expect(document.body.innerHTML).toBe(before);
    expect(result.set.title).toBe('Guía & diagramas');
    expect(result.set.description).toBe('Resumen general del servicio.');
    expect(result.set.diagrams.map((diagram) => [diagram.title, diagram.kind, diagram.description])).toEqual([
      ['Entrada <principal>', 'graph', 'Cómo llega el lector al mostrador.'],
      ['Respuesta', 'sequence', undefined],
      ['Respuesta', 'graph', undefined]
    ]);
    const flow = result.set.diagrams[0];
    expect(flow.nodes.map((node) => node.title)).toEqual(['Lector', 'Mostrador & caja', 'Salida']);
    expect(flow.nodes[0].link).toBeUndefined();
    expect(result.set.diagrams[1].items[0].label).toBe('Hola mundo');
    expect(result.warnings.map((warning) => warning.code)).toContain('unsafe_link');
  });

  it('reads capidocs SVG metadata in CDATA or escaped form', async () => {
    const diagram = { id: 'svg', title: 'Desde SVG', nodes: [{ id: 'a', title: 'A </script>' }] };
    const cdata = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="capidocs-diagram"><![CDATA[${JSON.stringify(diagram)}]]></metadata><rect/></svg>`;
    const escaped = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="capidocs-diagram">${JSON.stringify(diagram).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</metadata></svg>`;
    for (const text of [cdata, escaped]) {
      const result = await importDiagramFile({ name: 'export.svg', text });
      expect(result.ok).toBe(true);
      expect(result.set.diagrams[0].nodes[0].title).toBe('A </script>');
    }
  });

  it('opens draw.io SVG exports through their embedded model', async () => {
    const content = read('library.drawio').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const result = await importDiagramFile({ name: 'library.drawio.svg', text: `<svg xmlns="http://www.w3.org/2000/svg" content="${content}"><g/></svg>` });
    expect(result).toMatchObject({ ok: true, format: 'svg' });
    expect(result.set.diagrams).toHaveLength(2);
  });

  it('ignores look-alike scripts and unclosed tags', () => {
    const scan = scanHtml('<script type="application/json" id="other">{}</script><h1>Uno<p>Párrafo sin cierre<pre class="mermaid">graph LR\nA-->B</pre>');
    expect(scan.setJson).toBeNull();
    expect(scan.firstHeading).toBe('Uno');
    expect(scan.mermaid).toHaveLength(1);
    expect(scan.mermaid[0].heading.description).toBe('Párrafo sin cierre');
  });

  it('stays linear on hostile markup', () => {
    const hostile = '<h1>'.repeat(20000) + '<p>'.repeat(20000) + '<div class="mermaid">'.repeat(5000);
    const started = performance.now();
    expect(() => importHtml(hostile)).toThrow();
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('hostile input', () => {
  const spaces = ' '.repeat(200000);
  const cases = {
    'sequence alias': `sequenceDiagram\nparticipant a${spaces}b\nA->>B: x`,
    'sequence note': `sequenceDiagram\nA->>B: x\nNote over${spaces}`,
    'sequence link': `sequenceDiagram\nA->>B: x\nlink A:${spaces}x`,
    'er alias': `erDiagram\nE [${spaces}\nE ||--o{ F : x`,
    'er attribute': `erDiagram\nE {\n  string${spaces}x "${spaces}\n}`,
    'flowchart quotes': `flowchart LR\nA["open\n${'x\n'.repeat(100000)}`,
    'flowchart label': `flowchart LR\nA["\`${'**a'.repeat(100000)}\`"] --> B`,
    'markdown heading': `# a${spaces}b\n\n\`\`\`mermaid\ngraph LR\nA-->B\n\`\`\``,
    'markdown paragraph': `## T\n${'![a'.repeat(100000)}\n\n\`\`\`mermaid\ngraph LR\nA-->B\n\`\`\``
  };

  it.each(Object.keys(cases))('handles %s in linear time', async (name) => {
    const started = performance.now();
    const result = await importDiagramText(cases[name], { hint: name.startsWith('markdown') ? 'markdown' : 'mermaid' });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(typeof result.ok).toBe('boolean');
  });
});
