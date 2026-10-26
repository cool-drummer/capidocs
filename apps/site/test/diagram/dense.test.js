import { describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { layoutDiagram } from '../../assets/js/diagram/layout/index.js';

const PAIRS = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 4], [2, 4], [2, 5], [3, 5], [3, 6], [4, 7],
  [5, 7], [5, 8], [6, 8], [7, 9], [8, 9], [9, 1], [6, 2], [4, 8], [0, 9], [3, 7],
  [7, 2], [1, 6],
];
const LABELS = ['lee', 'publica', 'consulta', 'notifica', 'valida', 'agenda'];

function denseDiagram(direction = 'LR') {
  const result = validateDiagramSet({
    title: 'Denso',
    diagrams: [{
      id: 'dense',
      title: 'Denso',
      direction,
      groups: [{ id: 'core', title: 'Biblioteca', color: 'blue' }],
      nodes: Array.from({ length: 10 }, (_, index) => ({ id: `m${index}`, title: `Pieza ${index}`, subtitle: `lib/pieza-${index}`, group: 'core', badge: 'Pieza' })),
      edges: PAIRS.map(([from, to], index) => ({ id: `d${index}`, from: `m${from}`, to: `m${to}`, label: index % 2 ? LABELS[index % LABELS.length] : undefined })),
    }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.set.diagrams[0];
}

const center = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const length = (points) => points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);

describe('dense groups', () => {
  for (const direction of ['LR', 'TB']) {
    it(`keeps 22 edges between 10 modules short, inside their group and readable (${direction})`, () => {
      const scene = layoutDiagram(denseDiagram(direction));
      expect(scene.edges).toHaveLength(22);
      const group = scene.groups[0];
      const boxes = new Map(scene.nodes.map((node) => [node.id, node]));
      for (const edge of scene.edges) {
        for (const point of edge.points) {
          expect(point.x, edge.id).toBeGreaterThanOrEqual(group.x);
          expect(point.x, edge.id).toBeLessThanOrEqual(group.x + group.w);
          expect(point.y, edge.id).toBeGreaterThanOrEqual(group.y);
          expect(point.y, edge.id).toBeLessThanOrEqual(group.y + group.h);
        }
      }
      const total = scene.edges.reduce((sum, edge) => sum + length(edge.points), 0);
      const direct = scene.edges.reduce((sum, edge) => {
        const a = center(boxes.get(edge.from));
        const b = center(boxes.get(edge.to));
        return sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      }, 0);
      expect(total / direct).toBeLessThan(1.1);
      const visible = scene.edges.filter((edge) => edge.labelBox && !edge.labelHidden).map((edge) => edge.labelBox);
      expect(visible.length).toBeGreaterThanOrEqual(scene.edges.filter((edge) => edge.label).length - 2);
      for (let i = 0; i < visible.length; i += 1) {
        for (let j = i + 1; j < visible.length; j += 1) expect(overlaps(visible[i], visible[j])).toBe(false);
        for (const node of scene.nodes) expect(overlaps(visible[i], node)).toBe(false);
      }
    });
  }

  it('merges parallel edges into one line with both labels', () => {
    const result = validateDiagramSet({
      title: 'Paralelas',
      diagrams: [{
        id: 'p',
        title: 'Paralelas',
        nodes: [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }],
        edges: [{ id: 'x', from: 'a', to: 'b', label: 'lee' }, { id: 'y', from: 'a', to: 'b', label: 'escribe' }, { id: 'z', from: 'b', to: 'a' }],
      }],
    });
    const scene = layoutDiagram(result.set.diagrams[0]);
    expect(scene.edges.map((edge) => edge.id)).toEqual(['x', 'z']);
    expect(scene.edges[0].label).toBe('lee, escribe');
    expect(scene.edges[0].merged).toEqual(['y']);
  });
});
