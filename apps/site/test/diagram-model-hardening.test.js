import { describe, expect, it } from 'vitest';
import { combineDiagramSets, describeJsonError, mergeDiagramSets, parseDiagramSetJson, validateDiagramSet } from '../assets/js/diagram/model.js';
import { createIdFactory, parseCssDeclarations } from '../assets/js/diagram/import/shared.js';

describe('combining diagram sets', () => {
  const set = (id, link) => validateDiagramSet({ title: id, diagrams: [{ id, title: id, nodes: [{ id: 'n', title: 'N', ...(link ? { link: { diagram: link } } : {}) }] }] }).set;

  it('renames colliding ids, relinks them and validates once', () => {
    const result = combineDiagramSets([set('a'), set('a', 'a'), set('a', 'a')], { title: 'Todo' });
    expect(result.ok).toBe(true);
    expect(result.set.title).toBe('Todo');
    expect(result.set.diagrams.map((diagram) => [diagram.id, diagram.nodes[0].link?.diagram])).toEqual([['a', undefined], ['a-2', 'a-2'], ['a-3', 'a-3']]);
    expect(mergeDiagramSets(set('a'), set('a', 'a')).set.diagrams.map((diagram) => diagram.id)).toEqual(['a', 'a-2']);
  });
});


describe('model validation of languages and reserved names', () => {
  const base = (patch = {}, diagram = {}, node = {}) => ({
    title: 'x',
    ...patch,
    diagrams: [{ id: 'd', title: 'D', ...diagram, nodes: [{ id: 'n', title: 'N', ...node }] }]
  });
  const messages = (input) => validateDiagramSet(input).issues.map((issue) => `${issue.path}: ${issue.message}`);

  it('accepts and canonicalizes BCP 47 tags and rejects the rest', () => {
    expect(validateDiagramSet(base({ lang: 'en-us' })).set.lang).toBe('en-US');
    expect(validateDiagramSet(base({ lang: 'zh-Hant-TW' })).set.lang).toBe('zh-Hant-TW');
    expect(validateDiagramSet(base({ lang: 'es-419' })).set.lang).toBe('es-419');
    expect(validateDiagramSet(base()).set.lang).toBe('es');
    for (const lang of ['x', 'es_MX', 'english', 'en-', '12', 'en-us-x-private-thing-way-too-long', '<script>']) {
      expect(messages(base({ lang }))).toContain('lang: Invalid language tag');
    }
  });

  it('rejects prototype names as icons, ids and link targets', () => {
    expect(messages(base({}, {}, { icon: 'constructor' }))).toContain('diagrams.0.nodes.0.icon: Invalid icon name');
    expect(messages(base({}, {}, { icon: 'prototype' }))).toContain('diagrams.0.nodes.0.icon: Invalid icon name');
    expect(messages(base({ categories: [{ id: 'c', title: 'C', icon: 'constructor' }] }, { category: 'c' }))).toContain('categories.0.icon: Invalid icon name');
    expect(messages(base({ icons: { constructor: { paths: ['M0 0'] }, prototype: { paths: ['M0 0'] } } }))).toEqual(
      expect.arrayContaining(['icons.constructor: Invalid icon name', 'icons.prototype: Invalid icon name'])
    );
    expect(messages(base({}, {}, { icon: 'valueof' }))).toContain('diagrams.0.nodes.0.icon: Unknown icon "valueof"');
    expect(messages(base({}, { id: 'constructor' }))).toContain('diagrams.0.id: "constructor" is a reserved identifier');
    expect(messages(base({}, {}, { id: 'prototype' }))).toContain('diagrams.0.nodes.0.id: "prototype" is a reserved identifier');
    expect(messages(base({}, {}, { link: { diagram: 'constructor' } }))).toContain('diagrams.0.nodes.0.link.diagram: "constructor" is a reserved identifier');
    expect(messages(JSON.parse('{"title":"x","__proto__":{"polluted":1},"diagrams":[]}'))).toContain('__proto__: Unknown key "__proto__"');
    expect({}.polluted).toBeUndefined();
  });

  it('never repeats file content in JSON errors', () => {
    const result = parseDiagramSetJson('##\n# Host secret.example 10.0.0.1\n');
    expect(result.issues).toEqual([{ path: '(root)', message: 'Invalid JSON' }]);
    expect(parseDiagramSetJson('{').issues[0].message).toMatch(/^Invalid JSON( at position \d+)?$/);
    expect(describeJsonError(new SyntaxError('Unexpected token in JSON at position 7'))).toBe('Invalid JSON at position 7');
  });
});


describe('importer helpers', () => {
  it('keeps generated ids away from reserved names', () => {
    const ids = createIdFactory('node');
    expect([ids.id('constructor'), ids.id('prototype'), ids.id('__proto__'), ids.id('constructor')]).toEqual(['constructor-2', 'prototype-2', 'proto', 'constructor-2']);
  });

  it('parses style declarations into null-prototype records', () => {
    const declarations = parseCssDeclarations('__proto__: polluted; constructor: x; fill: #f00');
    expect(Object.getPrototypeOf(declarations)).toBeNull();
    expect(declarations.fill).toBe('#f00');
    expect({}.polluted).toBeUndefined();
  });
});
