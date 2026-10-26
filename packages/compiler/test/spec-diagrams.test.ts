import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateSpecDiagrams } from '../src/spec-diagrams.js';

const validSet = { title: 'Mapa', diagrams: [{ id: 'main', title: 'Principal', nodes: [{ id: 'a', title: 'A' }] }] };

describe('validateSpecDiagrams', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'capidocs-diagrams-'));
    await mkdir(join(dir, 'config', 'diagrams'), { recursive: true });
    await writeFile(join(dir, 'config', 'diagrams', 'ok.json'), JSON.stringify(validSet));
    await writeFile(join(dir, 'config', 'diagrams', 'broken.json'), JSON.stringify({ title: 'Roto', diagrams: [{ id: 'x', title: 'X', nodes: [{ id: 'bad id', title: 'B' }] }] }));
    await writeFile(join(dir, 'config', 'diagrams', 'flow.mmd'), 'flowchart LR\n  A --> B');
    await writeFile(join(dir, 'config', 'diagrams', 'single.json'), JSON.stringify(validSet.diagrams[0]));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function specWith(blocks: unknown[]): unknown {
    return { pages: { guide: { template: 'content', content: { title: 'Guía', sections: blocks.map((diagram, index) => ({ title: `S${index}`, diagram })) } } } };
  }

  it('accepts inline sets, relative files and existing diagram ids', async () => {
    const issues = await validateSpecDiagrams(specWith([
      { set: validSet, diagram: 'main', height: 400, caption: 'Pie' },
      { src: 'config/diagrams/ok.json' },
      { src: 'config/diagrams/flow.mmd' },
      { src: 'https://example.com/remote.json' },
    ]), { baseDir: dir });
    expect(issues).toEqual([]);
  });

  it('reports invalid sets, missing files, escapes and unknown diagrams with their paths', async () => {
    const issues = await validateSpecDiagrams(specWith([
      { set: { title: 'Sin diagramas', diagrams: [] } },
      { src: 'config/diagrams/broken.json' },
      { src: 'config/diagrams/missing.json' },
      { src: '../outside.json' },
      { src: 'config/diagrams/ok.json', diagram: 'nope' },
      { set: validSet, src: 'config/diagrams/ok.json' },
      { caption: 'Solo pie', diagram: 'main' },
      { src: 'config/diagrams/single.json' },
    ]), { baseDir: dir });
    const base = 'pages.guide.content.sections';
    expect(issues).toEqual(expect.arrayContaining([
      { path: `${base}.0.diagram.set.diagrams`, message: 'At least one diagram is required' },
      { path: `${base}.1.diagram.src(config/diagrams/broken.json).diagrams.0.nodes.0.id`, message: 'Invalid identifier' },
      { path: `${base}.2.diagram.src`, message: 'File not found: config/diagrams/missing.json' },
      { path: `${base}.3.diagram.src`, message: '"../outside.json" points outside the site directory' },
      { path: `${base}.4.diagram.diagram`, message: 'Unknown diagram "nope"' },
      { path: `${base}.5.diagram`, message: 'Use either "set" or "src", not both' },
      { path: `${base}.6.diagram`, message: 'A diagram block needs "set" or "src"' },
      { path: `${base}.7.diagram.src(config/diagrams/single.json).diagrams`, message: 'At least one diagram is required' },
    ].map((issue) => expect.objectContaining(issue))));
    expect(issues.every((issue) => issue.path.startsWith(base))).toBe(true);
  });

  it('ignores specs without diagram blocks', async () => {
    expect(await validateSpecDiagrams({ pages: { home: { diagram: 'just a string' } } }, { baseDir: dir })).toEqual([]);
  });
});
