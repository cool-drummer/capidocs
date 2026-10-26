import { describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { layoutDiagram } from '../../assets/js/diagram/layout/index.js';

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomDiagram(nodeCount, edgeCount, { groups = 0, seed = 1 } = {}) {
  const rand = seeded(seed);
  const result = validateDiagramSet({
    title: 'Carga',
    diagrams: [{
      id: 'load',
      title: 'Carga',
      groups: Array.from({ length: groups }, (_, index) => ({ id: `g${index}`, title: `Grupo ${index}` })),
      nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}`, title: `Nodo ${index}`, ...(groups ? { group: `g${index % groups}` } : {}) })),
      edges: Array.from({ length: edgeCount }, (_, index) => ({
        from: `n${Math.floor(rand() * nodeCount)}`,
        to: `n${Math.floor(rand() * nodeCount)}`,
        ...(index % 4 === 0 ? { label: `paso ${index}` } : {}),
      })),
    }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues.slice(0, 3)));
  return result.set.diagrams[0];
}

const timed = (diagram) => {
  const started = process.cpuUsage();
  const scene = layoutDiagram(diagram);
  const used = process.cpuUsage(started);
  return { scene, ms: (used.user + used.system) / 1000 };
};

const plain = (scene) => JSON.stringify(scene, (key, value) => (key === 'source' ? undefined : value));

describe('layout performance', () => {
  it('lays out 300 nodes and 900 random edges in under a second and a half', () => {
    const { scene, ms } = timed(randomDiagram(300, 900));
    expect(scene.nodes).toHaveLength(300);
    expect(ms).toBeLessThan(1500);
  }, 20000);

  it('keeps the model ceiling of 1000 nodes and 3000 edges far from a freeze', () => {
    const { scene, ms } = timed(randomDiagram(1000, 3000));
    expect(scene.nodes).toHaveLength(1000);
    expect(ms).toBeLessThan(5000);
  }, 30000);

  it('bounds the routing work when many edges cross groups', () => {
    const { scene, ms } = timed(randomDiagram(100, 300, { groups: 10, seed: 7 }));
    expect(scene.edges.length).toBeGreaterThan(250);
    expect(ms).toBeLessThan(2500);
  }, 20000);

  it('stays deterministic when the work budget kicks in', () => {
    const diagram = randomDiagram(150, 450, { seed: 3 });
    expect(plain(layoutDiagram(diagram))).toBe(plain(layoutDiagram(diagram)));
  }, 20000);
});
