import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDF_LIMITS, buildPdf, readJpegInfo, toWinAnsi } from '../assets/js/diagram/export/pdf.js';

const jpeg = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'diagrams', 'tile.jpg')));
const TEXT = 'Diagrama de acción: ¿Niño? ¡Sí! Pingüino, José y Úrsula';
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

function hasTool(name) {
  try {
    execFileSync(name, ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sample() {
  return buildPdf([
    { width: 320, height: 160, jpeg, imageWidth: 16, imageHeight: 8, texts: [{ x: 20, y: 40, size: 14, text: TEXT, width: 280 }, { x: 20, y: 80, size: 12, text: 'Paréntesis (y) barra \\ invertida' }] },
    { width: 200, height: 100, texts: [{ x: 10, y: 50, size: 12, text: 'Segunda página' }] }
  ], { title: 'Título con acentos: ñandú', lang: 'es', creationDate: new Date(Date.UTC(2026, 9, 26, 12, 0, 0)) });
}

describe('buildPdf', () => {
  it('writes a well-formed PDF 1.7 with a correct cross-reference table', () => {
    const bytes = sample();
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.7\n%')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    const header = /xref\n0 (\d+)\n/.exec(text.slice(startxref));
    const count = Number(header[1]);
    const entries = text.slice(startxref + header[0].length).split('trailer')[0];
    expect(entries.length).toBe(count * 20);
    for (let id = 1; id < count; id += 1) {
      const offset = Number(entries.slice(id * 20, id * 20 + 10));
      expect(text.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
    expect(text).toContain(`/Size ${count} /Root 1 0 R /Info 4 0 R`);
    expect(text).toContain('/Count 2');
  });

  it('declares metadata, the font, the JPEG image and an invisible text layer', () => {
    const text = latin1(sample());
    const title = /\/Title <FEFF([0-9A-F]*)>/.exec(text)[1];
    expect(Buffer.from(title, 'hex').swap16().toString('utf16le')).toBe('Título con acentos: ñandú');
    expect(text).toContain(`/Producer <FEFF${Buffer.from('capidocs', 'utf16le').swap16().toString('hex').toUpperCase()}>`);
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).toContain('/Subtype /Image /Width 16 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(text).toContain('/MediaBox [0 0 240 120]');
    expect(text).toContain('/MediaBox [0 0 150 75]');
    expect(text).toContain('3 Tr');
    expect(text).toContain('(Diagrama de acci\\363n: \\277Ni\\361o? \\241S\\355! Ping\\374ino, Jos\\351 y \\332rsula) Tj');
    expect(text).toContain('(Par\\351ntesis \\(y\\) barra \\\\ invertida) Tj');
    expect(text).toContain('/Lang <FEFF00650073>');
  });

  it('caps very large pages and rejects invalid input', () => {
    const text = latin1(buildPdf([{ width: 100000, height: 50000 }]));
    expect(text).toContain(`/MediaBox [0 0 ${PDF_LIMITS.maxPagePoints} ${PDF_LIMITS.maxPagePoints / 2}]`);
    expect(() => buildPdf([])).toThrow(TypeError);
    expect(() => buildPdf([{ width: 0, height: 10 }])).toThrow(TypeError);
    expect(() => buildPdf([{ width: 10, height: 10, jpeg: new Uint8Array([1, 2, 3]) }])).toThrow(TypeError);
  });

  it('encodes text as WinAnsi with sensible fallbacks', () => {
    expect([...toWinAnsi('áéíóúñüÁÉÍÓÚÑÜ¿¡')]).toEqual([0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xf1, 0xfc, 0xc1, 0xc9, 0xcd, 0xd3, 0xda, 0xd1, 0xdc, 0xbf, 0xa1]);
    expect([...toWinAnsi('€ “x” — …')]).toEqual([0x80, 0x20, 0x93, 0x78, 0x94, 0x20, 0x97, 0x20, 0x85]);
    expect([...toWinAnsi('ăș中')]).toEqual([0x61, 0x73, 0x3f]);
  });

  it('reads JPEG headers', () => {
    expect(readJpegInfo(jpeg)).toEqual({ width: 16, height: 8, components: 3, adobe: false });
    expect(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it.skipIf(!hasTool('pdftotext') || !hasTool('pdfinfo'))('opens in poppler and extracts the accented text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capidocs-pdf-'));
    try {
      const file = join(dir, 'sample.pdf');
      writeFileSync(file, sample());
      const info = execFileSync('pdfinfo', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(info).toMatch(/Pages:\s+2/);
      expect(info).toMatch(/Title:\s+Título con acentos: ñandú/);
      expect(info).toMatch(/PDF version:\s+1\.7/);
      const extracted = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(extracted).toContain(TEXT);
      expect(extracted).toContain('Segunda página');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
