import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, validateDiagramSet } from '../assets/js/diagram/model.js';
import { importMermaid, mermaidType, parseMermaid } from '../assets/js/diagram/import/mermaid.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'diagrams');

function load(source, options) {
  const { set, warnings } = importMermaid(source, options);
  const result = validateDiagramSet(set);
  expect(result.issues).toEqual([]);
  return { diagram: result.set.diagrams[0], set: result.set, warnings };
}

const byTitle = (diagram, title) => diagram.nodes.find((node) => node.title === title);

describe('mermaid flowchart', () => {
  it('maps every node shape', () => {
    const { diagram } = load(`flowchart TD
      a[Rect] --- b(Round) --- c([Stadium]) --- d[(Base)] --- e{Decision}
      f((Circle)) --- g>Flag] --- h[[Sub]] --- i{{Hex}} --- j[/Lean/] --- k(((Double)))
      l@{ shape: cyl, label: "Nuevo cilindro" }`);
    const shapes = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.shape]));
    expect(shapes).toEqual({
      a: 'card', b: 'card', c: 'pill', d: 'cylinder', e: 'diamond', f: 'circle', g: 'note', h: 'card', i: 'diamond', j: 'card', k: 'circle', l: 'cylinder'
    });
    expect(byTitle(diagram, 'Nuevo cilindro')).toBeTruthy();
    expect(diagram.direction).toBe('TB');
  });

  it('maps edge styles, arrows and both label syntaxes', () => {
    const { diagram, warnings } = load(`graph LR
      A --> B
      A --- C
      A -.-> D
      A ==> E
      A --x F
      A --o G
      A <--> H
      A -->|pipe label| I
      A -- inline label --> J
      A -. dotted label .-> K
      A == thick label ==> L
      A ~~~ M`);
    const edge = (to) => diagram.edges.find((entry) => entry.to === to);
    expect([edge('B').style, edge('B').arrow]).toEqual(['solid', 'end']);
    expect(edge('C').arrow).toBe('none');
    expect(edge('D').style).toBe('dotted');
    expect(edge('E').style).toBe('thick');
    expect(edge('F').arrow).toBe('end');
    expect(edge('G').arrow).toBe('end');
    expect(edge('H').arrow).toBe('both');
    expect(edge('I').label).toBe('pipe label');
    expect(edge('J').label).toBe('inline label');
    expect([edge('K').label, edge('K').style]).toEqual(['dotted label', 'dotted']);
    expect([edge('L').label, edge('L').style]).toEqual(['thick label', 'thick']);
    expect(edge('M')).toBeUndefined();
    expect(byTitle(diagram, 'M')).toBeTruthy();
    expect(warnings.map((warning) => warning.code)).toContain('approximated_arrow');
  });

  it('expands chains and ampersands', () => {
    const { diagram } = load('flowchart LR\n  A --> B --> C\n  X & Y --> Z & W; Q-->R');
    const pairs = diagram.edges.map((edge) => `${edge.from}>${edge.to}`);
    expect(pairs).toEqual(['A>B', 'B>C', 'X>Z', 'X>W', 'Y>Z', 'Y>W', 'Q>R']);
  });

  it('turns nested subgraphs into groups and assigns members', () => {
    const { diagram } = load(`flowchart TB
      outside --> api
      subgraph platform [Plataforma]
        direction LR
        api
        subgraph data["Datos"]
          db[(DB)]
        end
        api --> db
      end
      subgraph Solo
        lonely
      end
      outside --> platform`);
    expect(diagram.groups.map((group) => [group.id, group.title, group.parent])).toEqual([
      ['platform', 'Plataforma', undefined], ['data', 'Datos', 'platform'], ['Solo', 'Solo', undefined]
    ]);
    expect(diagram.nodes.find((node) => node.id === 'api').group).toBe('platform');
    expect(diagram.nodes.find((node) => node.id === 'db').group).toBe('data');
    expect(diagram.nodes.find((node) => node.id === 'outside').group).toBeUndefined();
    expect(diagram.edges.some((edge) => edge.to === 'platform')).toBe(true);
  });

  it('keeps only safe click links', () => {
    const { diagram, warnings } = load(`flowchart LR
      A --> B --> C --> D --> E
      click A href "https://example.com/a" "Ver A"
      click B "javascript:alert(1)"
      click C href "data:text/html,<script>alert(1)</script>"
      click D callback "tip"
      click E "mailto:ayuda@example.com"`);
    const link = (id) => diagram.nodes.find((node) => node.id === id).link;
    expect(link('A')).toEqual({ href: 'https://example.com/a', label: 'Ver A' });
    expect(link('B')).toBeUndefined();
    expect(link('C')).toBeUndefined();
    expect(link('D')).toBeUndefined();
    expect(link('E').href).toBe('mailto:ayuda@example.com');
    expect(warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['unsafe_link', 'unsupported_click']));
  });

  it('maps classDef, class, ::: and style colors to the palette', () => {
    const { diagram } = load(`flowchart LR
      classDef hot fill:#f8cecc,stroke:#b85450
      classDef cool fill:#dae8fc
      A:::hot --> B --> C --> D
      class B cool
      style C fill:#d5e8d4,stroke:#82b366
      style D fill:#ffffff,stroke:#000000`);
    const color = (id) => diagram.nodes.find((node) => node.id === id).color;
    expect([color('A'), color('B'), color('C'), color('D')]).toEqual(['red', 'blue', 'green', undefined]);
  });

  it('cleans labels: entities, line breaks, markdown strings and HTML', () => {
    const { diagram } = load(`flowchart LR
      A["Línea uno<br/>línea dos"] --> B["#quot;Comillas#quot; y #35;"]
      C["\`**Negrita** y texto\`"] --> D["<img src=x onerror=alert(1)>Hola </script><script>alert(1)</script>"]`);
    expect(byTitle(diagram, 'Línea uno').subtitle).toBe('línea dos');
    expect(byTitle(diagram, '"Comillas" y #')).toBeTruthy();
    expect(byTitle(diagram, 'Negrita y texto')).toBeTruthy();
    const hostile = diagram.nodes.find((node) => node.id === 'D');
    expect(hostile.title).toBe('Hola');
    expect(JSON.stringify(diagram)).not.toMatch(/<script|onerror/);
  });

  it('turns arbitrary ids into stable, unique, valid identifiers', () => {
    const { diagram } = load('flowchart LR\n  ñandú --> nandu\n  _x --> x\n  água --> agua\n  中文 --> 日本');
    const ids = diagram.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/);
    expect(diagram.nodes.find((node) => node.title === 'ñandú').id).toBe('nandu');
    expect(diagram.nodes.find((node) => node.title === 'nandu').id).toBe('nandu-2');
    const again = load('flowchart LR\n  ñandú --> nandu\n  _x --> x\n  água --> agua\n  中文 --> 日本').diagram;
    expect(again.nodes.map((node) => node.id)).toEqual(ids);
  });

  it('reads front matter, accessibility text and ignores comments and directives', () => {
    const { diagram } = load(`---
title: Título del flujo
config:
  theme: dark
---
%%{init: {"flowchart": {"curve": "basis"}}}%%
flowchart LR
  %% A --> Hidden
  accDescr: Descripción accesible
  A --> B`);
    expect(diagram.title).toBe('Título del flujo');
    expect(diagram.description).toBe('Descripción accesible');
    expect(diagram.nodes.map((node) => node.id)).toEqual(['A', 'B']);
  });

  it('imports the fixture file', () => {
    const { diagram } = load(readFileSync(join(fixtures, 'flow.mmd'), 'utf8'));
    expect(diagram.title).toBe('Préstamo de libros');
    expect(diagram.groups).toHaveLength(1);
    expect(diagram.nodes.find((node) => node.id === 'catalog').link.href).toBe('https://example.com/catalogo');
    expect(diagram.nodes.find((node) => node.id === 'wait').color).toBe('red');
  });

  it('caps nodes and edges and stays fast on explosive input', () => {
    const left = Array.from({ length: 3000 }, (_, index) => `a${index}`).join(' & ');
    const right = Array.from({ length: 3000 }, (_, index) => `b${index}`).join(' & ');
    const started = performance.now();
    const { diagram, warnings } = load(`flowchart LR\n${left} --> ${right}`);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(diagram.nodes.length).toBe(LIMITS.nodes);
    expect(diagram.edges.length).toBeLessThanOrEqual(LIMITS.edges);
    expect(warnings.map((warning) => warning.code)).toContain('limit_exceeded');
  });

  it('flattens subgraphs nested deeper than the model allows', () => {
    const depth = 20;
    const open = Array.from({ length: depth }, (_, index) => `subgraph g${index}`).join('\n');
    const close = Array.from({ length: depth }, () => 'end').join('\n');
    const { diagram, warnings } = load(`flowchart LR\n${open}\ninner --> other\n${close}`);
    expect(diagram.groups.length).toBe(LIMITS.depth);
    expect(warnings.map((warning) => warning.code)).toContain('flattened_groups');
  });
});

describe('mermaid sequence', () => {
  it('maps participants, messages, notes and blocks', () => {
    const { diagram } = load(`sequenceDiagram
      title Préstamo
      autonumber
      participant L as Lector
      actor B as Bibliotecaria
      participant D@{ "type": "database" }
      L->>+B: Pide un libro
      activate B
      B-->>-L: Ficha
      B-)D: Registra
      D--)B: Ok
      B-xL: Error
      B--xL: Rechazo
      L->L: Piensa
      L-->B: Responde
      Note left of L: Nota izquierda
      Note over L,B: Nota<br>compartida
      loop Cada día
        alt Disponible
          B->>L: Entrega
        else No disponible
          B->>L: Espera
        end
      end
      par Avisos
        B->>L: Correo
      and
        B->>L: SMS
      end
      critical Cierre
        B->>D: Guarda
      option Falla
        B->>L: Disculpa
      end
      break Sin red
        B->>L: Reintenta
      end
      opt Extra
        L->>B: Gracias
      end`);
    expect(diagram.kind).toBe('sequence');
    expect(diagram.title).toBe('Préstamo');
    expect(diagram.autonumber).toBe(true);
    expect(diagram.participants.map((participant) => [participant.id, participant.title, participant.kind])).toEqual([
      ['L', 'Lector', 'system'], ['B', 'Bibliotecaria', 'actor'], ['D', 'D', 'store']
    ]);
    const messages = diagram.items.filter((item) => item.type === 'message');
    expect(messages.map((item) => item.style)).toEqual(['sync', 'reply', 'async', 'async', 'sync', 'reply', 'sync', 'reply']);
    const notes = diagram.items.filter((item) => item.type === 'note');
    expect(notes.map((note) => note.over)).toEqual([['L'], ['L', 'B']]);
    expect(notes[1].text).toBe('Nota\ncompartida');
    const blocks = diagram.items.filter((item) => item.type === 'block');
    expect(blocks.map((block) => block.kind)).toEqual(['loop', 'par', 'critical', 'break', 'opt']);
    expect(blocks[0].items[0].branches[0].label).toBe('No disponible');
    expect(blocks[1].branches).toHaveLength(1);
    expect(blocks[2].branches[0].label).toBe('Falla');
  });

  it('keeps nesting within the model depth and flags flattening', () => {
    const depth = 16;
    const open = Array.from({ length: depth }, (_, index) => `loop nivel ${index}`).join('\n');
    const close = Array.from({ length: depth }, () => 'end').join('\n');
    const { warnings } = load(`sequenceDiagram\nA->>B: inicio\n${open}\nA->>B: dentro\n${close}`);
    expect(warnings.map((warning) => warning.code)).toContain('flattened_blocks');
  });

  it('drops unsafe participant links', () => {
    const { diagram, warnings } = load(`sequenceDiagram
      participant A
      participant B
      link A: Panel @ https://example.com/panel
      link B: Malo @ javascript:alert(1)
      A->>B: hola`);
    expect(diagram.participants[0].link).toEqual({ href: 'https://example.com/panel', label: 'Panel' });
    expect(diagram.participants[1].link).toBeUndefined();
    expect(warnings.map((warning) => warning.code)).toContain('unsafe_link');
  });
});

describe('mermaid er', () => {
  it('maps entities, attributes, keys and relationships', () => {
    const { diagram } = load(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE-ITEM : "contains items"
      CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
      CAR 1 to zero or more NAMED-DRIVER : allows
      CUSTOMER["Cliente"] {
        string name PK "Nombre completo"
        varchar(255) email UK
        int address_id FK
      }`);
    const customer = diagram.nodes.find((node) => node.id === 'CUSTOMER');
    expect(customer.shape).toBe('table');
    expect(customer.title).toBe('Cliente');
    expect(customer.fields).toEqual([
      { name: 'name', type: 'string', key: 'pk', note: 'Nombre completo' },
      { name: 'email', type: 'varchar(255)', key: 'uk' },
      { name: 'address_id', type: 'int', key: 'fk' }
    ]);
    expect(diagram.edges.map((edge) => [edge.from, edge.to, edge.label, edge.style, edge.arrow, edge.description])).toEqual([
      ['CUSTOMER', 'ORDER', 'places', 'solid', 'none', '1 : 0..N'],
      ['ORDER', 'LINE-ITEM', 'contains items', 'solid', 'none', '1 : 1..N'],
      ['CUSTOMER', 'DELIVERY-ADDRESS', 'uses', 'dashed', 'none', '1..N : 1..N'],
      ['CAR', 'NAMED-DRIVER', 'allows', 'solid', 'none', '1 : 0..N']
    ]);
  });
});

describe('mermaid detection', () => {
  it('detects supported types and rejects others', () => {
    expect(mermaidType('graph TD\nA-->B')).toBe('flowchart');
    expect(mermaidType('%% c\nsequenceDiagram\nA->>B: x')).toBe('sequence');
    expect(mermaidType('erDiagram')).toBe('er');
    expect(mermaidType('classDiagram\nA <|-- B')).toBeNull();
    expect(() => parseMermaid('pie title Pets\n"Dogs" : 386')).toThrow(expect.objectContaining({ code: 'unsupported_format' }));
    expect(() => parseMermaid('   \n  ')).toThrow(expect.objectContaining({ code: 'empty' }));
  });
});
