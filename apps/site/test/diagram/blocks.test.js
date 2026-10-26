import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentGenerator } from '../../assets/js/content-generator.js';
import { createTranslator } from '../../assets/js/spec-loader.js';
import { HANDOFF_KEY, mountDiagramBlocks } from '../../assets/js/diagram/blocks.js';

const siteDir = join(import.meta.dirname, '../..');
const spec = JSON.parse(readFileSync(join(siteDir, 'config/api-spec.json'), 'utf8'));
const sample = JSON.parse(readFileSync(join(siteDir, 'test/fixtures/diagrams/sample.json'), 'utf8'));

function render(diagram) {
  const generator = new ContentGenerator({ spec, t: createTranslator(spec) });
  const host = document.createElement('div');
  host.innerHTML = generator.generateContentSection({ title: 'Diagrama', diagram });
  document.body.appendChild(host);
  return host;
}

describe('diagram block', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a placeholder with a link to the explorer for a set file', () => {
    const host = render({ src: 'config/diagrams/capidocs.json', diagram: 'architecture', height: 420, caption: 'Arquitectura' });
    const block = host.querySelector('[data-diagram-block]');
    expect(block.dataset.height).toBe('420');
    expect(block.querySelector('figcaption').textContent).toContain('Arquitectura');
    expect(block.querySelector('.diagram-block-open').getAttribute('href')).toBe('diagrams.html?src=config%2Fdiagrams%2Fcapidocs.json#/d/architecture');
    expect(host.innerHTML).not.toMatch(/\sstyle="/);
  });

  it('embeds inline sets safely', () => {
    const hostile = { ...sample, title: '</script><script>alert(1)</script>' };
    const host = render({ set: hostile, caption: '<b>x</b>' });
    expect(host.querySelectorAll('script:not([data-diagram-set])')).toHaveLength(0);
    expect(JSON.parse(host.querySelector('script[data-diagram-set]').textContent).title).toBe(hostile.title);
    expect(host.querySelector('figcaption b')).toBeNull();
  });

  it('mounts a viewer for an inline set and hands it to the explorer', async () => {
    const host = render({ set: sample, diagram: 'checkout', height: 360 });
    const [viewer] = await mountDiagramBlocks(host);
    expect(viewer.diagram.id).toBe('checkout');
    expect(host.querySelector('.diagram-block-canvas').style.height).toBe('360px');
    expect(host.querySelector('[data-diagram-block]').dataset.mounted).toBe('true');
    host.querySelector('.diagram-block-open').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(JSON.parse(localStorage.getItem(HANDOFF_KEY)).title).toBe(sample.title);
    expect(await mountDiagramBlocks(host)).toHaveLength(0);
    viewer.destroy();
  });

  it('refuses sources from another origin with a friendly message', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = render({ src: 'https://evil.example/set.json' });
    expect(await mountDiagramBlocks(host, { t: (key, fallback) => fallback })).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(host.querySelector('.diagram-block-status').textContent).toBe('No se pudo cargar el diagrama.');
    expect(host.querySelector('.diagram-block-open')).toBeNull();
  });
});
