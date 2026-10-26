import { describe, expect, it } from 'vitest';
import { initialCamera, MIN_INITIAL_ZOOM } from '../../assets/js/diagram/viewer.js';

describe('initial camera', () => {
  const view = { w: 1000, h: 700 };

  it('fits the whole diagram when that stays readable', () => {
    const camera = initialCamera({ kind: 'graph', direction: 'LR', width: 1200, height: 500 }, view);
    expect(camera.k).toBeCloseTo((1000 - 64) / 1200, 5);
    expect(camera.x + (1200 * camera.k) / 2).toBeCloseTo(500, 5);
  });

  it('never opens below the zoom floor and starts at the first rank', () => {
    const scene = { kind: 'graph', direction: 'LR', width: 6000, height: 3000, flowStart: { x: 40, y: 2000, w: 200, h: 300 } };
    const camera = initialCamera(scene, view);
    expect(camera.k).toBe(MIN_INITIAL_ZOOM);
    expect(camera.x).toBeCloseTo(16, 5);
    const firstRankCenter = camera.y + (2000 + 150) * camera.k;
    expect(firstRankCenter).toBeCloseTo(350, 5);
  });

  it('starts sequences at the top', () => {
    const camera = initialCamera({ kind: 'sequence', width: 3000, height: 4000, participants: [{ x: 32, y: 32, w: 140, h: 44 }] }, view);
    expect(camera.k).toBe(MIN_INITIAL_ZOOM);
    expect(camera.y).toBeCloseTo(16, 5);
  });
});
