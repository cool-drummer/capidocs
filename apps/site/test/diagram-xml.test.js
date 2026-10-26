import { describe, expect, it } from 'vitest';
import { XmlError, attribute, childElements, descendants, parseXml, rootElement, textContent } from '../assets/js/diagram/xml.js';

function fails(source, code, options) {
  try {
    parseXml(source, options);
  } catch (error) {
    expect(error).toBeInstanceOf(XmlError);
    expect(error.code).toBe(code);
    return;
  }
  throw new Error('Expected the parser to fail');
}

describe('parseXml', () => {
  it('reads elements, attributes, text, CDATA and skips comments', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- hello --><root a="1" b=\'dos\'><item>uno</item><item><![CDATA[<b>dos</b> & más]]></item><empty/></root>');
    const root = rootElement(doc);
    expect(root.name).toBe('root');
    expect(attribute(root, 'a')).toBe('1');
    expect(attribute(root, 'b')).toBe('dos');
    const items = childElements(root, 'item');
    expect(items.map(textContent)).toEqual(['uno', '<b>dos</b> & más']);
    expect(childElements(root, 'empty')).toHaveLength(1);
    expect(descendants(doc, 'item')).toHaveLength(2);
  });

  it('decodes the five standard entities and numeric references only', () => {
    const root = rootElement(parseXml('<r v="&lt;&gt;&amp;&quot;&apos;&#233;&#x1F600;&#0;&nbsp;">&amp;lt; &#xE9;t&#233; &unknown;</r>'));
    expect(attribute(root, 'v')).toBe('<>&"\'é\u{1F600}\ufffd&nbsp;');
    expect(textContent(root)).toBe('&lt; été &unknown;');
  });

  it('normalizes literal whitespace in attributes but keeps character references', () => {
    const root = rootElement(parseXml('<r v="a\nb&#10;c\td"/>'));
    expect(attribute(root, 'v')).toBe('a b\nc d');
  });

  it('ignores DOCTYPE declarations without expanding external or recursive entities', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY % p "x">]><r>&xxe;</r>';
    expect(textContent(rootElement(parseXml(xxe)))).toBe('&xxe;');
    const laughs = ['<!DOCTYPE lolz [<!ENTITY lol "lol">'];
    for (let level = 1; level <= 9; level += 1) laughs.push(`<!ENTITY lol${level} "${`&lol${level - 1};`.repeat(10)}">`);
    laughs.push(']><lolz>&lol9;</lolz>');
    const started = performance.now();
    expect(textContent(rootElement(parseXml(laughs.join(''))))).toBe('&lol9;');
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('enforces size, depth and node limits', () => {
    fails('<r>' + 'x'.repeat(50) + '</r>', 'too_large', { maxLength: 20 });
    fails('<a>'.repeat(70) + '</a>'.repeat(70), 'too_deep');
    fails('<r>' + '<i/>'.repeat(30) + '</r>', 'too_many_nodes', { maxNodes: 10 });
    const deep = '<a>'.repeat(200000) + '</a>'.repeat(200000);
    fails(deep, 'too_deep');
  });

  it('rejects malformed documents', () => {
    fails('<a><b></a></b>', 'malformed');
    fails('<a>', 'malformed');
    fails('<a x="1" x="2"/>', 'malformed');
    fails('<a x="<b>"/>', 'malformed');
    fails('<a/><b/>', 'malformed');
    fails('<a x=1/>', 'malformed');
    fails('text<a/>', 'malformed');
    fails('<!DOCTYPE a [<!ENTITY x "y"', 'malformed');
    fails('', 'malformed');
  });

  it('stores attributes without touching Object.prototype', () => {
    const root = rootElement(parseXml('<r __proto__="polluted" constructor="c" toString="t"/>'));
    expect(attribute(root, '__proto__')).toBe('polluted');
    expect(attribute(root, 'hasOwnProperty')).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(root.attributes)).toBeNull();
  });
});
