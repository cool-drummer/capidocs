import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDiagramSet } from '../../assets/js/diagram/model.js';
import { layoutDiagram } from '../../assets/js/diagram/layout/index.js';
import { METRICS } from '../../assets/js/diagram/metrics.js';

const siteDir = join(import.meta.dirname, '../..');
const load = (path) => {
  const result = validateDiagramSet(JSON.parse(readFileSync(join(siteDir, path), 'utf8')));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.set;
};
const sample = load('test/fixtures/diagrams/sample.json');
const demo = load('config/diagrams/capidocs.json');
const sets = [sample, demo];
const graphs = sets.flatMap((set) => set.diagrams.filter((diagram) => diagram.kind === 'graph'));
const sequences = sets.flatMap((set) => set.diagrams.filter((diagram) => diagram.kind === 'sequence'));
const byId = (set, id) => set.diagrams.find((diagram) => diagram.id === id);

const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
const contains = (outer, inner) => inner.x >= outer.x - 0.01 && inner.y >= outer.y - 0.01 && inner.x + inner.w <= outer.x + outer.w + 0.01 && inner.y + inner.h <= outer.y + outer.h + 0.01;
const plain = (scene) => JSON.stringify(scene, (key, value) => (key === 'source' ? undefined : value));

function graph(nodes, edges = [], extra = {}) {
  const result = validateDiagramSet({ title: 'Prueba', diagrams: [{ id: 'g', title: 'Prueba', nodes, edges, ...extra }] });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.set.diagrams[0];
}

describe('graph layout', () => {
  it('is deterministic', () => {
    for (const diagram of [...graphs, ...sequences]) {
      expect(plain(layoutDiagram(diagram)), diagram.id).toBe(plain(layoutDiagram(diagram)));
    }
  });

  it('never overlaps two nodes', () => {
    for (const diagram of graphs) {
      const scene = layoutDiagram(diagram);
      for (let i = 0; i < scene.nodes.length; i += 1) {
        for (let j = i + 1; j < scene.nodes.length; j += 1) {
          expect(overlaps(scene.nodes[i], scene.nodes[j]), `${diagram.id}: ${scene.nodes[i].id} / ${scene.nodes[j].id}`).toBe(false);
        }
      }
    }
  });

  it('keeps every node, nested group and chip inside the scene', () => {
    for (const diagram of graphs) {
      const scene = layoutDiagram(diagram);
      const frame = { x: 0, y: 0, w: scene.width, h: scene.height };
      for (const node of scene.nodes) expect(contains(frame, node), `${diagram.id}: ${node.id}`).toBe(true);
      for (const group of scene.groups) expect(contains(frame, group.header), `${diagram.id}: ${group.id}`).toBe(true);
    }
  });

  it('places groups around their children and apart from their siblings', () => {
    for (const diagram of graphs) {
      const scene = layoutDiagram(diagram);
      const groups = new Map(scene.groups.map((group) => [group.id, group]));
      for (const node of scene.nodes) {
        if (!node.source.group) continue;
        expect(contains(groups.get(node.source.group), node), `${diagram.id}: ${node.id}`).toBe(true);
      }
      for (const group of scene.groups) {
        const parent = group.source.parent && groups.get(group.source.parent);
        if (parent) expect(contains(parent, { ...group, y: group.header.y, h: group.h + group.y - group.header.y }), group.id).toBe(true);
      }
      for (const a of scene.groups) {
        for (const b of scene.groups) {
          if (a === b || a.source.parent !== b.source.parent || a.collapsed || b.collapsed) continue;
          expect(overlaps(a, b), `${diagram.id}: ${a.id} / ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps nodes inside their lane and lanes apart from each other', () => {
    const diagram = byId(demo, 'publish-pipeline');
    const scene = layoutDiagram(diagram);
    expect(scene.lanes).toHaveLength(4);
    const lanes = new Map(scene.lanes.map((lane) => [lane.id, lane]));
    for (const node of scene.nodes) expect(contains(lanes.get(node.source.lane), node), node.id).toBe(true);
    for (let i = 0; i + 1 < scene.lanes.length; i += 1) {
      expect(scene.lanes[i].x + scene.lanes[i].w).toBeLessThanOrEqual(scene.lanes[i + 1].x);
    }
    for (const node of scene.nodes) expect(node.y).toBeGreaterThanOrEqual(scene.lanes[0].y + METRICS.lane.header);
  });

  it('honors the lane order of a pipeline', () => {
    const scene = layoutDiagram(byId(sample, 'lineage'));
    const x = Object.fromEntries(scene.nodes.map((node) => [node.id, node.x]));
    expect(x.raw).toBeLessThan(x.clean);
    expect(x.clean).toBeLessThan(x.report);
  });

  it('routes edges orthogonally from the border of one box to the border of the other', () => {
    for (const diagram of graphs) {
      const scene = layoutDiagram(diagram);
      const boxes = new Map([...scene.nodes, ...scene.groups].map((item) => [item.id, item]));
      for (const edge of scene.edges) {
        const points = edge.points;
        expect(points.length, edge.id).toBeGreaterThanOrEqual(2);
        for (let i = 0; i + 1 < points.length; i += 1) {
          const straight = Math.abs(points[i].x - points[i + 1].x) < 0.01 || Math.abs(points[i].y - points[i + 1].y) < 0.01;
          expect(straight, `${diagram.id}: ${edge.id} segment ${i}`).toBe(true);
        }
        const near = (point, box) => point.x >= box.x - 1 && point.x <= box.x + box.w + 1 && point.y >= box.y - 1 && point.y <= box.y + box.h + 1;
        expect(near(points[0], boxes.get(edge.from)), `${diagram.id}: ${edge.id} start`).toBe(true);
        expect(near(points[points.length - 1], boxes.get(edge.to)), `${diagram.id}: ${edge.id} end`).toBe(true);
      }
    }
  });

  it('places edge labels away from nodes and from each other', () => {
    for (const diagram of graphs) {
      const scene = layoutDiagram(diagram);
      const labels = scene.edges.filter((edge) => edge.labelBox && !edge.labelHidden).map((edge) => edge.labelBox);
      expect(labels.length).toBe(scene.edges.filter((edge) => edge.label).length);
      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) expect(overlaps(labels[i], labels[j]), diagram.id).toBe(false);
        for (const node of scene.nodes) expect(overlaps(labels[i], node), `${diagram.id}: label over ${node.id}`).toBe(false);
      }
    }
  });

  it('flows left to right, top to bottom and in reverse', () => {
    const nodes = [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }, { id: 'c', title: 'Tres' }];
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];
    const position = (direction) => Object.fromEntries(layoutDiagram(graph(nodes, edges, { direction })).nodes.map((node) => [node.id, node]));
    const lr = position('LR');
    expect(lr.a.x).toBeLessThan(lr.b.x);
    const rl = position('RL');
    expect(rl.a.x).toBeGreaterThan(rl.b.x);
    const tb = position('TB');
    expect(tb.a.y).toBeLessThan(tb.b.y);
    const bt = position('BT');
    expect(bt.a.y).toBeGreaterThan(bt.c.y);
  });

  it('collapses a group into its chip and redirects its edges', () => {
    const diagram = byId(sample, 'overview');
    const scene = layoutDiagram(diagram, { collapsed: new Set(['data']) });
    expect(scene.nodes.map((node) => node.id)).not.toContain('db');
    expect(scene.nodes.map((node) => node.id)).not.toContain('orders');
    const data = scene.groups.find((group) => group.id === 'data');
    expect(data.collapsed).toBe(true);
    expect(data.w).toBe(data.header.w);
    expect(scene.edges.find((edge) => edge.id === 'e-api-db').to).toBe('data');
  });

  it('merges parallel edges when an outer group collapses', () => {
    const diagram = byId(sample, 'overview');
    const scene = layoutDiagram(diagram, { collapsed: new Set(['platform']) });
    expect(scene.groups.map((group) => group.id)).toEqual(['platform']);
    expect(scene.nodes.map((node) => node.id).sort()).toEqual(['buyer', 'payments']);
    expect(scene.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(['buyer>platform', 'platform>payments']);
  });

  it('grows a card when its details are expanded', () => {
    const diagram = byId(sample, 'overview');
    const closed = layoutDiagram(diagram, { expanded: new Set() }).nodes.find((node) => node.id === 'web');
    const open = layoutDiagram(diagram, { expanded: new Set(['web']) }).nodes.find((node) => node.id === 'web');
    expect(open.expanded).toBe(true);
    expect(open.h).toBeGreaterThan(closed.h + 60);
  });

  it('keeps the relative positions of a manual diagram and respects waypoints', () => {
    const diagram = graph(
      [{ id: 'a', title: 'Uno', x: 0, y: 0 }, { id: 'b', title: 'Dos', x: 400, y: 200 }],
      [{ id: 'ab', from: 'a', to: 'b', points: [{ x: 300, y: 30 }] }],
    );
    const scene = layoutDiagram(diagram);
    expect(scene.manual).toBe(true);
    const [a, b] = scene.nodes;
    expect(b.x - a.x).toBe(400);
    expect(b.y - a.y).toBe(200);
    expect(scene.edges[0].points.some((point) => point.x === a.x + 300)).toBe(true);
  });

  it('routes self loops outside the node', () => {
    const scene = layoutDiagram(graph([{ id: 'a', title: 'Uno' }], [{ id: 'loop', from: 'a', to: 'a' }]));
    const node = scene.nodes[0];
    expect(scene.edges[0].points.some((point) => point.y > node.y + node.h)).toBe(true);
  });
});

describe('sequence layout', () => {
  const scene = layoutDiagram(byId(sample, 'checkout'));

  it('orders participants from left to right without overlapping', () => {
    for (let i = 0; i + 1 < scene.participants.length; i += 1) {
      const a = scene.participants[i];
      const b = scene.participants[i + 1];
      expect(a.x + a.w).toBeLessThan(b.x);
      expect(a.lifeline.x).toBeLessThan(b.lifeline.x);
    }
  });

  it('stacks messages downwards and numbers them', () => {
    const ys = scene.messages.map((message) => message.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(ys.length);
    expect(scene.messages.map((message) => message.index)).toEqual(scene.messages.map((message, index) => index + 1));
    expect(scene.messages.at(-1).self).toBe(true);
  });

  it('wraps the messages of a block and separates its branches', () => {
    const [block] = scene.blocks;
    expect(block.kind).toBe('alt');
    expect(block.dividers).toHaveLength(1);
    const inside = scene.messages.filter((message) => message.y > block.y && message.y < block.y + block.h);
    expect(inside).toHaveLength(3);
    for (const message of inside) {
      expect(Math.min(message.x1, message.x2)).toBeGreaterThan(block.x);
      expect(Math.max(message.x1, message.x2)).toBeLessThan(block.x + block.w);
    }
    expect(block.dividers[0].y).toBeGreaterThan(inside[1].y);
    expect(block.dividers[0].y).toBeLessThan(inside[2].y);
  });

  it('leaves room for every message label between the lifelines', () => {
    for (const message of scene.messages.filter((entry) => !entry.self && entry.labelBox)) {
      expect(message.labelBox.w).toBeLessThanOrEqual(Math.abs(message.x2 - message.x1));
    }
  });

  it('extends lifelines past the last item and keeps notes in the scene', () => {
    const last = Math.max(...scene.messages.map((message) => message.y2 ?? message.y), ...scene.notes.map((note) => note.y + note.h));
    for (const participant of scene.participants) expect(participant.lifeline.y2).toBeGreaterThan(last);
    expect(scene.notes).toHaveLength(1);
    expect(scene.notes[0].x).toBeGreaterThanOrEqual(0);
    expect(scene.notes[0].x + scene.notes[0].w).toBeLessThanOrEqual(scene.width);
  });
});
