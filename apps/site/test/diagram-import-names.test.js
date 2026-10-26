import { describe, expect, it } from 'vitest';
import { importDiagramFile, importDiagramText } from '../assets/js/diagram/import/index.js';

describe('importers never resolve names through the prototype chain', () => {
  it('imports mermaid sources that use prototype names', async () => {
    const flow = await importDiagramText('flowchart LR\nconstructor --> prototype\nA@{ shape: constructor, label: "x" }\nclassDef __proto__ fill:#f00\nclass constructor __proto__', { hint: 'mermaid' });
    expect(flow.ok).toBe(true);
    expect(flow.set.diagrams[0].nodes.map((node) => [node.id, node.title, node.shape])).toEqual([
      ['constructor-2', 'constructor', 'card'], ['prototype-2', 'prototype', 'card'], ['A', 'x', 'card']
    ]);
    expect(flow.set.diagrams[0].nodes[0].color).toBe('red');
    const sequence = await importDiagramText('sequenceDiagram\nparticipant constructor@{ "type": "constructor" }\nconstructor->>prototype: hola', { hint: 'mermaid' });
    expect(sequence.ok).toBe(true);
    expect(sequence.set.diagrams[0].participants.map((participant) => [participant.id, participant.kind])).toEqual([['constructor-2', 'system'], ['prototype-2', 'system']]);
    expect(await importDiagramText('constructor\nA-->B', { hint: 'mermaid' })).toMatchObject({ ok: false, error: { code: 'unsupported_format' } });
    expect(await importDiagramFile({ name: 'x.constructor', text: 'graph LR\nA-->B' })).toMatchObject({ ok: true, format: 'mermaid' });
    expect(await importDiagramText('graph LR\nA-->B', { hint: 'constructor' })).toMatchObject({ ok: true });
  });

});
