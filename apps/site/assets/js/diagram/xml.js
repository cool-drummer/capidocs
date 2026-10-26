export const XML_LIMITS = {
    maxLength: 32 * 1024 * 1024,
    maxDepth: 64,
    maxNodes: 500000,
    maxAttributes: 256
};

export class XmlError extends Error {
    constructor(code, detail, offset) {
        super(detail);
        this.name = 'XmlError';
        this.code = code;
        this.detail = detail;
        this.offset = offset;
    }
}

const PREDEFINED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const REFERENCE = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(lt|gt|amp|quot|apos));/g;
const ELEMENT_NAME = /[^\s/>"'<=]+/y;
const ATTRIBUTE_NAME = /[^\s/>"'<=]+/y;
const WHITESPACE = /\s*/y;

function codePoint(value) {
    if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(value);
}

export function decodeXmlEntities(value) {
    if (!value.includes('&')) return value;
    return value.replace(REFERENCE, (match, hex, decimal, name) => {
        if (hex) return codePoint(parseInt(hex, 16));
        if (decimal) return codePoint(parseInt(decimal, 10));
        return PREDEFINED[name];
    });
}

function skipDoctype(text, start) {
    let pos = start + 9;
    let subset = false;
    while (pos < text.length) {
        const char = text[pos];
        if (char === '"' || char === "'") {
            const end = text.indexOf(char, pos + 1);
            if (end === -1) break;
            pos = end + 1;
            continue;
        }
        if (subset && text.startsWith('<!--', pos)) {
            const end = text.indexOf('-->', pos + 4);
            if (end === -1) break;
            pos = end + 3;
            continue;
        }
        if (char === '[') subset = true;
        else if (char === ']') subset = false;
        else if (char === '>' && !subset) return pos + 1;
        pos += 1;
    }
    throw new XmlError('malformed', 'Unterminated DOCTYPE', start);
}

function read(pattern, text, pos) {
    pattern.lastIndex = pos;
    const match = pattern.exec(text);
    return match ? match[0] : '';
}

function skipSpace(text, pos) {
    WHITESPACE.lastIndex = pos;
    WHITESPACE.exec(text);
    return WHITESPACE.lastIndex;
}

export function parseXml(source, options = {}) {
    const limits = { ...XML_LIMITS, ...options };
    if (typeof source !== 'string') throw new XmlError('invalid_input', 'Expected text', 0);
    if (source.length > limits.maxLength) throw new XmlError('too_large', `Document longer than ${limits.maxLength} characters`, 0);
    const text = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, '\n');
    const document = { type: 'document', children: [] };
    const stack = [document];
    let nodes = 0;
    let pos = 0;

    const count = (offset) => {
        nodes += 1;
        if (nodes > limits.maxNodes) throw new XmlError('too_many_nodes', `More than ${limits.maxNodes} nodes`, offset);
    };
    const appendText = (value, offset) => {
        if (!value) return;
        const parent = stack[stack.length - 1];
        if (parent === document) {
            if (value.trim()) throw new XmlError('malformed', 'Text outside the root element', offset);
            return;
        }
        const last = parent.children[parent.children.length - 1];
        if (last && last.type === 'text') {
            last.value += value;
            return;
        }
        count(offset);
        parent.children.push({ type: 'text', value });
    };

    while (pos < text.length) {
        const lt = text.indexOf('<', pos);
        if (lt === -1) {
            appendText(decodeXmlEntities(text.slice(pos)), pos);
            break;
        }
        if (lt > pos) appendText(decodeXmlEntities(text.slice(pos, lt)), pos);

        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            if (end === -1) throw new XmlError('malformed', 'Unterminated comment', lt);
            if (limits.comments && stack.length > 1) {
                count(lt);
                stack[stack.length - 1].children.push({ type: 'comment', value: text.slice(lt + 4, end) });
            }
            pos = end + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', lt)) {
            const end = text.indexOf(']]>', lt + 9);
            if (end === -1) throw new XmlError('malformed', 'Unterminated CDATA section', lt);
            if (stack.length === 1) throw new XmlError('malformed', 'CDATA outside the root element', lt);
            appendText(text.slice(lt + 9, end), lt);
            pos = end + 3;
            continue;
        }
        if (text.startsWith('<?', lt)) {
            const end = text.indexOf('?>', lt + 2);
            if (end === -1) throw new XmlError('malformed', 'Unterminated processing instruction', lt);
            pos = end + 2;
            continue;
        }
        if (text.startsWith('<!', lt)) {
            if (text.slice(lt + 2, lt + 9).toUpperCase() !== 'DOCTYPE') throw new XmlError('malformed', 'Unsupported markup declaration', lt);
            if (stack.length > 1) throw new XmlError('malformed', 'DOCTYPE inside an element', lt);
            pos = skipDoctype(text, lt);
            continue;
        }
        if (text[lt + 1] === '/') {
            const name = read(ELEMENT_NAME, text, lt + 2);
            const close = skipSpace(text, lt + 2 + name.length);
            if (!name || text[close] !== '>') throw new XmlError('malformed', 'Malformed closing tag', lt);
            const open = stack[stack.length - 1];
            if (open === document || open.name !== name) throw new XmlError('malformed', `Unexpected closing tag </${name}>`, lt);
            stack.pop();
            pos = close + 1;
            continue;
        }

        const name = read(ELEMENT_NAME, text, lt + 1);
        if (!name) throw new XmlError('malformed', 'Malformed tag', lt);
        if (stack.length === 1 && document.children.length) throw new XmlError('malformed', 'More than one root element', lt);
        const element = { type: 'element', name, attributes: Object.create(null), children: [] };
        let cursor = lt + 1 + name.length;
        let attributeCount = 0;
        let selfClosing = false;
        for (;;) {
            cursor = skipSpace(text, cursor);
            if (cursor >= text.length) throw new XmlError('malformed', 'Unterminated tag', lt);
            if (text[cursor] === '>') {
                cursor += 1;
                break;
            }
            if (text.startsWith('/>', cursor)) {
                cursor += 2;
                selfClosing = true;
                break;
            }
            const attribute = read(ATTRIBUTE_NAME, text, cursor);
            if (!attribute) throw new XmlError('malformed', 'Malformed attribute', cursor);
            cursor = skipSpace(text, cursor + attribute.length);
            if (text[cursor] !== '=') throw new XmlError('malformed', `Attribute "${attribute}" has no value`, cursor);
            cursor = skipSpace(text, cursor + 1);
            const quote = text[cursor];
            if (quote !== '"' && quote !== "'") throw new XmlError('malformed', `Attribute "${attribute}" is not quoted`, cursor);
            const end = text.indexOf(quote, cursor + 1);
            if (end === -1) throw new XmlError('malformed', 'Unterminated attribute value', cursor);
            const raw = text.slice(cursor + 1, end);
            if (raw.includes('<')) throw new XmlError('malformed', 'Attribute value contains "<"', cursor);
            if (Object.prototype.hasOwnProperty.call(element.attributes, attribute)) throw new XmlError('malformed', `Duplicate attribute "${attribute}"`, cursor);
            attributeCount += 1;
            if (attributeCount > limits.maxAttributes) throw new XmlError('too_many_nodes', `More than ${limits.maxAttributes} attributes`, cursor);
            element.attributes[attribute] = decodeXmlEntities(raw.replace(/[\t\n]/g, ' '));
            cursor = end + 1;
        }
        count(lt);
        stack[stack.length - 1].children.push(element);
        if (!selfClosing) {
            if (stack.length > limits.maxDepth) throw new XmlError('too_deep', `Nested deeper than ${limits.maxDepth} levels`, lt);
            stack.push(element);
        }
        pos = cursor;
    }

    if (stack.length > 1) throw new XmlError('malformed', `Unclosed element <${stack[stack.length - 1].name}>`, text.length);
    if (!document.children.length) throw new XmlError('malformed', 'No root element', 0);
    return document;
}

export function rootElement(document) {
    return document.children.find((child) => child.type === 'element') ?? null;
}

export function childElements(node, name) {
    return node.children.filter((child) => child.type === 'element' && (name === undefined || child.name === name));
}

export function firstChild(node, name) {
    return node.children.find((child) => child.type === 'element' && (name === undefined || child.name === name)) ?? null;
}

export function descendants(node, name) {
    const result = [];
    const pending = [...node.children].reverse();
    while (pending.length) {
        const current = pending.pop();
        if (current.type !== 'element') continue;
        if (name === undefined || current.name === name) result.push(current);
        for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
    }
    return result;
}

export function textContent(node) {
    if (node.type === 'text') return node.value;
    let result = '';
    const pending = [...node.children].reverse();
    while (pending.length) {
        const current = pending.pop();
        if (current.type === 'text') result += current.value;
        else if (current.type === 'element') {
            for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index]);
        }
    }
    return result;
}

export function attribute(node, name) {
    return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : undefined;
}
