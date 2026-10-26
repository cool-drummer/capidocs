import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { importDiagramFile } from '../../assets/js/diagram/import/index.js';
import { parseDrawio } from '../../assets/js/diagram/import/drawio.js';

describe('draw.io decompression budget', () => {
  const packed = (xml) => deflateRawSync(Buffer.from(xml), { level: 9 }).toString('base64');
  const file = (pages) => `<mxfile>${pages.map((page, index) => `<diagram id="p${index}">${page}</diagram>`).join('')}</mxfile>`;

  it('stops the reviewer bomb: 40 small pages that each expand to 500 000 nodes', async () => {
    const page = packed(`<mxGraphModel><root>${'<a/>'.repeat(499990)}</root></mxGraphModel>`);
    const text = file(Array.from({ length: 40 }, () => page));
    expect(text.length).toBeLessThan(200000);
    const started = performance.now();
    await expect(parseDrawio(text)).rejects.toMatchObject({ code: 'too_large' });
    expect(performance.now() - started).toBeLessThan(1000);
    const result = await importDiagramFile({ name: 'bomb.drawio', text });
    expect(result).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });

  it('shares the XML node budget across pages', async () => {
    const page = packed(`<mxGraphModel><root>${'<a/>'.repeat(200000)}</root></mxGraphModel>`);
    await expect(parseDrawio(file([page, page]))).rejects.toMatchObject({ code: 'empty' });
    await expect(parseDrawio(file([page, page, page]))).rejects.toMatchObject({ code: 'too_large' });
  });

  it('shares the inflated byte budget across pages', async () => {
    const page = packed(`<mxGraphModel><root><mxCell id="0" value="${'A'.repeat(11 * 1024 * 1024)}"/></root></mxGraphModel>`);
    await expect(parseDrawio(file([page, page]))).rejects.toMatchObject({ code: 'empty' });
    await expect(parseDrawio(file([page, page, page]))).rejects.toMatchObject({ code: 'too_large' });
  });
});

