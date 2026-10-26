import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../assets/js/diagram/model.js';
import { importDiagramFile } from '../assets/js/diagram/import/index.js';
import { buildStandaloneHtml, escapeJsonForHtml } from '../assets/js/diagram/export/standalone.js';
import { collectModules, findStaticImports, resolveSpecifier } from '../assets/js/diagram/export/modules.js';
import { bytesToBase64, sha256 } from '../assets/js/diagram/export/sha256.js';
import { hasChrome, openPage } from './helpers/chrome.js';

const siteDir = join(import.meta.dirname, '..');
const ENTRY = 'test/fixtures/diagrams/standalone-entry.js';
const readers = {
  readText: (path) => readFile(join(siteDir, path), 'utf8'),
  readBinary: async (path) => new Uint8Array(await readFile(join(siteDir, path)))
};
const sampleSet = () => {
  const set = JSON.parse(readFileSync(join(siteDir, 'test/fixtures/diagrams/sample.json'), 'utf8'));
  set.title = 'Título </script><!-- con \u2028 separadores \u2029 y <b>etiquetas</b>';
  return set;
};

function inline(html, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html);
  return match[1];
}

function hash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

describe('sha256', () => {
  it('matches node:crypto on block boundaries and unicode', () => {
    for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'ñandú \u2028 中文']) {
      expect(bytesToBase64(sha256(input))).toBe(createHash('sha256').update(input, 'utf8').digest('base64'));
    }
  });
});

describe('module graph', () => {
  it('finds static imports and ignores strings, comments, templates, regexes and dynamic imports', () => {
    const source = [
      "import a from './a.js';",
      "import { b, c as d } from \"../b.js\";",
      "import './side.js';",
      "export * from './star.js';",
      "export { e } from './e.js';",
      "export { local };",
      "export const re = /import x from '.\\/fake.js'/g;",
      "const s = \"import y from './fake2.js'\";",
      "// import z from './fake3.js';",
      "/* export * from './fake4.js' */",
      "const t = `${a}/import w from './fake5.js'/${`nested ${b}`}`;",
      "const lazy = import('./lazy.js');",
      "const meta = import.meta.url;",
      "const ratio = a / b / 2;",
      "const quote = /[\"'`]/;"
    ].join('\n');
    expect(findStaticImports(source).map((entry) => entry.specifier)).toEqual(['./a.js', '../b.js', './side.js', './star.js', './e.js']);
  });

  it('resolves relative specifiers inside the site root only', () => {
    expect(resolveSpecifier('assets/js/diagram/model.js', './icons.js')).toBe('assets/js/diagram/icons.js');
    expect(resolveSpecifier('test/fixtures/x.js', '../../assets/js/a.js')).toBe('assets/js/a.js');
    expect(() => resolveSpecifier('a.js', '../../etc/passwd')).toThrow(/site root/);
    expect(() => resolveSpecifier('a.js', 'lodash')).toThrow(/relative/);
  });

  it('orders dependencies before dependents and detects cycles', async () => {
    const files = {
      'main.js': "import './b.js'; import './a.js';",
      'a.js': "import './b.js';",
      'b.js': 'export const b = 1;',
      'loop-a.js': "import './loop-b.js';",
      'loop-b.js': "import './loop-a.js';"
    };
    const read = async (path) => files[path];
    const graph = await collectModules('main.js', read);
    expect(graph.modules.map((module) => module.path)).toEqual(['b.js', 'a.js', 'main.js']);
    await expect(collectModules('loop-a.js', read)).rejects.toThrow(/cycle/);
  });

  it('bundles the real diagram model with its icon dependency', async () => {
    const graph = await collectModules('assets/js/diagram/import/index.js', readers.readText);
    const paths = graph.modules.map((module) => module.path);
    expect(paths.indexOf('assets/js/diagram/icons.js')).toBeLessThan(paths.indexOf('assets/js/diagram/model.js'));
    expect(paths.at(-1)).toBe('assets/js/diagram/import/index.js');
  });
});

describe('buildStandaloneHtml', () => {
  it('builds a single file with a strict hash-based CSP', async () => {
    const html = await buildStandaloneHtml({ set: sampleSet(), entry: ENTRY, ...readers });
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1].replace(/&#39;/g, "'");
    const script = inline(html, 'script');
    const style = inline(html, 'style');
    expect(csp).toBe([
      "default-src 'none'", `script-src ${hash(script)} blob:`, `style-src ${hash(style)}`, 'font-src data:', 'img-src data: blob:',
      "connect-src 'none'", "base-uri 'none'", "form-action 'none'"
    ].join('; '));
    expect(csp).not.toContain('unsafe-inline');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    expect(style).toContain('@font-face{font-family:"Geist";src:url("data:font/woff2;base64,');
    expect(style).toContain('font-family:"Geist Mono"');
    expect(html).not.toMatch(/(src|href)="(?!data:)/);
    expect(html).toContain('<title>Título &lt;/script&gt;&lt;!-- con');
  });

  it('embeds the set and the modules safely and lets the importer read them back', async () => {
    const set = sampleSet();
    const html = await buildStandaloneHtml({ set, entry: ENTRY, ...readers });
    const blocks = [...html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)];
    expect(blocks.map((block) => block[1])).toEqual(['capidocs-diagram-set', 'capidocs-modules']);
    for (const [, , body] of blocks) {
      expect(body).not.toMatch(/<\/|<!--|\u2028|\u2029/);
    }
    const modules = JSON.parse(blocks[1][2]);
    expect(modules.modules.length).toBeGreaterThanOrEqual(5);
    expect(modules.entry).toBe(modules.modules.length - 1);
    const roundTrip = await importDiagramFile({ name: 'viewer.html', text: html });
    expect(roundTrip.ok).toBe(true);
    expect(roundTrip.set).toEqual(validateDiagramSet(set).set);
  });

  it('allows inline style attributes only when asked', async () => {
    const html = await buildStandaloneHtml({ set: sampleSet(), entry: ENTRY, allowStyleAttributes: true, ...readers });
    expect(html).toContain('style-src-attr &#39;unsafe-inline&#39;');
  });

  it('refuses invalid sets and missing entries', async () => {
    await expect(buildStandaloneHtml({ set: { title: 'x' }, entry: ENTRY, ...readers })).rejects.toThrow(/Invalid diagram set/);
    await expect(buildStandaloneHtml({ set: sampleSet(), entry: 'test/fixtures/diagrams/missing.js', ...readers })).rejects.toThrow();
    await expect(buildStandaloneHtml({ set: sampleSet(), ...readers })).rejects.toThrow(TypeError);
  });

  it('escapes every character that could end a script block', () => {
    expect(escapeJsonForHtml('{"a":"</script><!--\u2028\u2029&>"}')).toBe('{"a":"\\u003c/script\\u003e\\u003c!--\\u2028\\u2029\\u0026\\u003e"}');
  });

  it.skipIf(!hasChrome())('opens from file:// in headless Chrome without console errors or CSP violations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'capidocs-standalone-'));
    try {
      const set = sampleSet();
      const file = join(dir, 'viewer.html');
      writeFileSync(file, await buildStandaloneHtml({ set, entry: ENTRY, ...readers }));
      const result = await openPage(pathToFileURL(file).href, {
        expression: '({ title: document.querySelector("h1").textContent, items: document.querySelectorAll("li").length, test: window.capidocsTest })'
      });
      expect(result.errors).toEqual([]);
      expect(result.state).toBe('ready');
      expect(result.value.title).toBe(set.title);
      expect(result.value.items).toBe(set.diagrams.length);
      expect(result.value.test.fontsLoaded).toBeGreaterThan(0);
      expect(result.value.test.jpegBytes).toBeGreaterThan(100);
      expect(result.value.test.pngType).toBe('image/png');
      const pdf = join(dir, 'browser.pdf');
      writeFileSync(pdf, Buffer.from(result.value.test.pdf, 'base64'));
      let extracted = null;
      try {
        extracted = execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        extracted = null;
      }
      if (extracted !== null) expect(extracted).toContain('Diagrama de acción: ¿Niño? ¡Sí! Pingüino');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
