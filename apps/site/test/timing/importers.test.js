import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../assets/js/diagram/model.js';
import { importDiagramFile } from '../../assets/js/diagram/import/index.js';

const MAX = LIMITS.fileBytes - 1024;

function repeatTo(unit, budget) {
  return unit.repeat(Math.max(1, Math.floor(budget / unit.length)));
}

function chain(budget) {
  const parts = [];
  let length = 0;
  for (let index = 0; length < budget; index += 1) {
    const part = `n${index}[/x/]-->`;
    parts.push(part);
    length += part.length;
  }
  return parts.join('').replace(/-->$/, '');
}

async function timed(name, text) {
  expect(text.length).toBeLessThanOrEqual(LIMITS.fileBytes);
  const started = performance.now();
  const result = await importDiagramFile({ name, text });
  return { result, ms: performance.now() - started };
}

const flowBlock = () => '```mermaid\nflowchart LR\n' + Array.from({ length: 999 }, (_, index) => `a${index}-->a${index + 1}`).join('\n') + '\n```\n';

describe('importers stay linear on maximum-size hostile input', () => {
  it('shape properties with no separators', async () => {
    const { result, ms } = await timed('x.mmd', `flowchart LR\nA@{ ${repeatTo('a', MAX - 40)} }\nA --> B`);
    expect(ms).toBeLessThan(3000);
    expect(result.ok).toBe(true);
  });

  it('long chains of nested subgraphs', async () => {
    const { result, ms } = await timed('x.mmd', `flowchart LR\n${repeatTo('subgraph\n', MAX - 40)}A-->B\n`);
    expect(ms).toBeLessThan(3000);
    expect(result.ok).toBe(true);
    expect(result.set.diagrams[0].groups.length).toBeLessThanOrEqual(LIMITS.depth);
  });

  it('chains of shapes with alternative closers', async () => {
    const { result, ms } = await timed('x.mmd', `flowchart LR\n${chain(MAX - 40)}\n`);
    expect(ms).toBeLessThan(3000);
    expect(result.ok).toBe(true);
    expect(result.set.diagrams[0].nodes).toHaveLength(LIMITS.nodes);
  });

  it('nested pre tags inside a mermaid block', async () => {
    const half = Math.floor((MAX - 40) / 11);
    const { result, ms } = await timed('x.html', `<pre class="mermaid">${'<pre>'.repeat(half)}${'</pre>'.repeat(half)}x`);
    expect(ms).toBeLessThan(3000);
    expect(result.ok).toBe(false);
  });

  it('markdown headings full of image openers', async () => {
    const { result, ms } = await timed('x.md', repeatTo(`# ${'!['.repeat(8000)}\n`, MAX));
    expect(ms).toBeLessThan(3000);
    expect(result).toMatchObject({ ok: false, error: { code: 'empty' } });
  });

  it('markdown paragraphs full of image openers', async () => {
    const { result, ms } = await timed('x.md', repeatTo(`# t\n${'!['.repeat(8000)}\n\n`, MAX));
    expect(ms).toBeLessThan(3000);
    expect(result).toMatchObject({ ok: false, error: { code: 'empty' } });
  });

  it('the maximum number of large diagram blocks', async () => {
    const { result, ms } = await timed('x.md', Array.from({ length: LIMITS.diagrams }, flowBlock).join('\n'));
    expect(ms).toBeLessThan(3000);
    expect(result.ok).toBe(true);
    expect(result.set.diagrams).toHaveLength(LIMITS.diagrams);
  });
});

