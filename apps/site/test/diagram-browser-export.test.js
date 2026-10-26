import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, safeFilename } from '../assets/js/diagram/export/download.js';
import { RASTER_LIMITS, fitScale } from '../assets/js/diagram/export/raster.js';

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a temporary anchor and revokes the object URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:capidocs/1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });
    downloadBlob(new Blob(['x'], { type: 'text/plain' }), 'mapa/../«final».pdf');
    expect(clicked).toEqual([{ href: 'blob:capidocs/1', download: 'mapa-..-«final».pdf', attached: true }]);
    expect(document.querySelectorAll('a').length).toBe(0);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:capidocs/1');
  });

  it('sanitizes file names', () => {
    expect(safeFilename('  ..\u0000secreto:<x>.svg  ')).toBe('secreto-x-.svg');
    expect(safeFilename('')).toBe('diagram');
    expect(safeFilename('a'.repeat(300)).length).toBe(120);
  });
});

describe('fitScale', () => {
  it('keeps the requested scale when it fits', () => {
    expect(fitScale(800, 600, 2)).toEqual({ factor: 2, width: 1600, height: 1200 });
  });

  it('reduces the scale to respect side and area limits', () => {
    const wide = fitScale(20000, 100, 2);
    expect(wide.width).toBeLessThanOrEqual(RASTER_LIMITS.maxSide);
    const big = fitScale(5000, 5000, 3);
    expect(big.width * big.height).toBeLessThanOrEqual(RASTER_LIMITS.maxArea);
    expect(() => fitScale(0, 10)).toThrow(TypeError);
  });
});
