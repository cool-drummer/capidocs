import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStandaloneHtml } from '../../assets/js/diagram/export/standalone.js';
import { collectModules } from '../../assets/js/diagram/export/modules.js';
import { loadExportFonts, setExportFontCss } from '../../assets/js/diagram/render/fonts.js';

const siteDir = join(import.meta.dirname, '../..');
const ENTRY = 'assets/js/diagram/standalone-entry.js';
const readers = {
  readText: (path) => readFile(join(siteDir, path), 'utf8'),
  readBinary: async (path) => new Uint8Array(await readFile(join(siteDir, path))),
};

describe('standalone explorer entry', () => {
  it('bundles the explorer statically and leaves importers out', async () => {
    const graph = await collectModules(ENTRY, readers.readText);
    const paths = graph.modules.map((module) => module.path);
    expect(paths).toContain('assets/js/diagram/explorer.js');
    expect(paths).toContain('assets/js/diagram/export/pdf.js');
    expect(paths.some((path) => path.includes('/import/'))).toBe(false);
  });

  it('inlines the viewer and explorer styles without style attributes', async () => {
    const set = JSON.parse(await readFile(join(siteDir, 'config/diagrams/capidocs.json'), 'utf8'));
    const html = await buildStandaloneHtml({ set, entry: ENTRY, ...readers });
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    expect(css).toContain('.dg-viewer');
    expect(css).toContain('.dx-workspace');
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('id="capidocs-standalone"');
  });

  it('reuses fonts already inlined in the page for exports', async () => {
    setExportFontCss(null);
    const doc = document.implementation.createHTMLDocument('x');
    const style = doc.createElement('style');
    style.textContent = 'body{margin:0}@font-face{font-family:"Geist";src:url("data:font/woff2;base64,AAAA") format("woff2")}';
    doc.head.append(style);
    try {
      expect(await loadExportFonts({ doc })).toContain('data:font/woff2;base64,AAAA');
    } finally {
      setExportFontCss('');
    }
  });
});
