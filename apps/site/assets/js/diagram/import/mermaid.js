import { LIMITS } from '../model.js';
import {
    ImportError, Warnings, buildSet, chromaticColor, clip, createIdFactory, fallbackText,
    htmlToText, lines, namedEntity, own, parseCssDeclarations, safeHref, singleLine, splitLabel
} from './shared.js';

const TYPE_LINE = /^([A-Za-z][A-Za-z0-9-]*)\b(.*)$/;
const SUPPORTED = { flowchart: 'flowchart', graph: 'flowchart', 'flowchart-elk': 'flowchart', sequenceDiagram: 'sequence', erDiagram: 'er' };
const DIRECTION_MAP = { TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL' };

function unquote(value) {
    const text = String(value ?? '').trim();
    if (text.length >= 2 && ((text[0] === '"' && text.endsWith('"')) || (text[0] === "'" && text.endsWith("'")))) return text.slice(1, -1);
    return text;
}

function stripDirectives(text) {
    let result = '';
    let pos = 0;
    while (pos < text.length) {
        const start = text.indexOf('%%{', pos);
        if (start === -1) {
            result += text.slice(pos);
            break;
        }
        result += text.slice(pos, start);
        const end = text.indexOf('}%%', start + 3);
        pos = end === -1 ? text.length : end + 3;
    }
    return result;
}

function preprocess(source) {
    let text = String(source ?? '').replace(/\r\n?/g, '\n');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const meta = {};
    const front = /^\s*---[ \t]*\n/.exec(text);
    if (front) {
        const end = text.indexOf('\n---', front[0].length - 1);
        if (end !== -1) {
            for (const line of text.slice(front[0].length, end).split('\n')) {
                const match = /^title\s*:\s*(.+)$/.exec(line.trim());
                if (match) meta.title = unquote(match[1]);
            }
            const rest = text.indexOf('\n', end + 4);
            text = rest === -1 ? '' : text.slice(rest + 1);
        }
    }
    const kept = stripDirectives(text).split('\n').filter((line) => !line.trim().startsWith('%%'));
    return { lines: kept, meta };
}

function locateHeader(lines) {
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) continue;
        const match = TYPE_LINE.exec(line);
        return { index, keyword: match ? match[1] : line, rest: match ? match[2] : '' };
    }
    return null;
}

export function mermaidType(source) {
    const { lines: body } = preprocess(source);
    const header = locateHeader(body);
    if (!header) return null;
    return own(SUPPORTED, header.keyword) ?? null;
}

export function looksLikeMermaid(source) {
    const { lines: body } = preprocess(String(source ?? '').slice(0, 4096));
    const header = locateHeader(body);
    return Boolean(header && (own(SUPPORTED, header.keyword) || /^(classDiagram|stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|architecture(-beta)?|kanban)$/.test(header.keyword)));
}

const MERMAID_ENTITY = /#([A-Za-z][A-Za-z0-9]{1,31}|[0-9]{1,7});/g;

function decodeMermaidEntities(text) {
    if (!text.includes('#')) return text;
    return text.replace(MERMAID_ENTITY, (match, code) => {
        if (/^[0-9]+$/.test(code)) {
            const value = parseInt(code, 10);
            if ((value < 32 && value !== 10) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return match;
            return String.fromCodePoint(value);
        }
        return namedEntity(code) ?? match;
    });
}

const MAX_LABEL = 20000;

function cleanText(raw) {
    let text = String(raw ?? '').slice(0, MAX_LABEL).trim();
    if (text.length >= 2 && text[0] === '"' && text.endsWith('"')) text = text.slice(1, -1);
    let markdown = false;
    if (text.length >= 2 && text[0] === '`' && text.endsWith('`')) {
        text = text.slice(1, -1);
        markdown = true;
    }
    text = decodeMermaidEntities(text);
    text = htmlToText(text);
    if (markdown) text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/_([^_\n]+)_/g, '$1');
    text = text.replace(/\bfa[bkrs]?:fa-[\w-]+/g, '');
    return lines(text).join('\n');
}

function splitStatements(body, separators) {
    const statements = [];
    for (const line of body) {
        if (!separators || !line.includes(';')) {
            statements.push(line);
            continue;
        }
        let start = 0;
        let quote = false;
        let depth = 0;
        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            if (char === '"') quote = !quote;
            else if (quote) continue;
            else if (char === '[' || char === '(' || char === '{') depth += 1;
            else if (char === ']' || char === ')' || char === '}') depth = Math.max(0, depth - 1);
            else if (char === ';' && depth === 0) {
                statements.push(line.slice(start, index));
                start = index + 1;
            }
        }
        statements.push(line.slice(start));
    }
    return statements;
}

function joinMultilineStrings(body) {
    const result = [];
    let pending = null;
    let odd = false;
    for (const line of body) {
        let quotes = 0;
        for (let index = line.indexOf('"'); index !== -1; index = line.indexOf('"', index + 1)) quotes += 1;
        const text = pending === null ? line : `${pending}\n${line}`;
        odd = quotes % 2 === 1 ? !odd : odd;
        if (odd && text.length < MAX_LABEL) {
            pending = text;
            continue;
        }
        result.push(text);
        pending = null;
        odd = false;
    }
    if (pending !== null) result.push(pending);
    return result;
}

function collectAccessibility(statements, meta) {
    const rest = [];
    let description = null;
    for (const statement of statements) {
        const text = statement.trim();
        if (description !== null) {
            const close = text.indexOf('}');
            if (close === -1) {
                description.push(text);
                continue;
            }
            description.push(text.slice(0, close));
            meta.description = description.join('\n');
            description = null;
            continue;
        }
        let match = /^accTitle\s*:\s*(.*)$/.exec(text);
        if (match) {
            meta.title ??= match[1];
            continue;
        }
        match = /^accDescr\s*:\s*(.*)$/.exec(text);
        if (match) {
            meta.description = match[1];
            continue;
        }
        match = /^accDescr\s*\{(.*)$/.exec(text);
        if (match) {
            const close = match[1].indexOf('}');
            if (close !== -1) meta.description = match[1].slice(0, close);
            else description = [match[1]];
            continue;
        }
        rest.push(statement);
    }
    return rest;
}

function isIdChar(char) {
    if (char === undefined) return false;
    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36 || code >= 0xc0;
}

const SHAPES = [
    ['(((', [')))'], 'circle'],
    ['((', ['))'], 'circle'],
    ['([', ['])'], 'pill'],
    ['[(', [')]'], 'cylinder'],
    ['[[', [']]'], 'card'],
    ['[/', ['/]', '\\]'], 'card'],
    ['[\\', ['\\]', '/]'], 'card'],
    ['{{', ['}}'], 'diamond'],
    ['{', ['}'], 'diamond'],
    ['(', [')'], 'card'],
    ['[', [']'], 'card'],
    ['>', [']'], 'note']
];

const NEW_SHAPES = {
    rect: 'card', rounded: 'card', 'rounded-rect': 'card', stadium: 'pill', pill: 'pill', terminal: 'pill', circle: 'circle', circ: 'circle',
    'dbl-circ': 'circle', 'double-circle': 'circle', 'sm-circ': 'circle', 'small-circle': 'circle', diam: 'diamond', diamond: 'diamond',
    decision: 'diamond', question: 'diamond', hex: 'diamond', hexagon: 'diamond', prepare: 'diamond', cyl: 'cylinder', cylinder: 'cylinder',
    database: 'cylinder', db: 'cylinder', 'h-cyl': 'cylinder', 'lin-cyl': 'cylinder', disk: 'cylinder', das: 'cylinder', text: 'text',
    doc: 'note', document: 'note', 'flag': 'note', 'notch-rect': 'note', card: 'note', 'tag-doc': 'note'
};

const SHAPE_STARTS = '([{>';
const FLOW_KEYWORDS = new Set(['subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click']);
const MAX_SHAPE_BODY = 2000;
const MAX_SUBGRAPH_STACK = 1000;

function parseShapeProps(body) {
    const props = Object.create(null);
    let start = 0;
    let quote = false;
    for (let index = 0; index <= body.length; index += 1) {
        const char = body[index];
        if (char === '"' && body[index - 1] !== '\\') quote = !quote;
        if (index < body.length && (char !== ',' || quote)) continue;
        const part = body.slice(start, index);
        const colon = part.indexOf(':');
        if (colon !== -1) {
            const key = part.slice(0, colon).trim().toLowerCase();
            if (/^[a-z]{1,32}$/.test(key)) props[key] = unquote(part.slice(colon + 1).trim());
        }
        start = index + 1;
    }
    return props;
}

class Scanner {
    constructor(text) {
        this.text = text;
        this.pos = 0;
        this.found = new Map();
        this.hasEdgeIds = text.includes('@');
    }

    indexFrom(token, from) {
        const cached = this.found.get(token);
        if (cached && cached.from <= from && (cached.index === -1 || cached.index >= from)) return cached.index;
        const index = this.text.indexOf(token, from);
        this.found.set(token, { from, index });
        return index;
    }

    skip() {
        const { text } = this;
        while (this.pos < text.length) {
            const code = text.charCodeAt(this.pos);
            if (code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(text[this.pos]))) this.pos += 1;
            else break;
        }
    }

    done() {
        this.skip();
        return this.pos >= this.text.length;
    }

    readId() {
        const { text } = this;
        const start = this.pos;
        let end = start;
        while (end < text.length) {
            const char = text[end];
            if (isIdChar(char)) end += 1;
            else if ((char === '-' || char === '.') && end > start && isIdChar(text[end + 1])) end += 1;
            else break;
        }
        if (end === start) return null;
        this.pos = end;
        return text.slice(start, end);
    }

    readShape() {
        const { text } = this;
        const save = this.pos;
        this.skip();
        if (text.startsWith('@{', this.pos)) {
            const end = this.findClose('}', this.pos + 2);
            if (end === -1) {
                this.pos = save;
                return null;
            }
            const props = parseShapeProps(text.slice(this.pos + 2, end));
            this.pos = end + 1;
            return { shape: own(NEW_SHAPES, String(props.shape ?? '').toLowerCase()) ?? 'card', label: props.label };
        }
        if (!SHAPE_STARTS.includes(text[this.pos])) {
            this.pos = save;
            return null;
        }
        for (const [open, closers, shape] of SHAPES) {
            if (!text.startsWith(open, this.pos)) continue;
            let cursor = this.pos + open.length;
            while (cursor < text.length && text[cursor] === ' ') cursor += 1;
            if (text[cursor] === '"') {
                const quoteEnd = this.indexFrom('"', cursor + 1);
                if (quoteEnd !== -1) {
                    let after = quoteEnd + 1;
                    while (after < text.length && text[after] === ' ') after += 1;
                    const closer = closers.find((candidate) => text.startsWith(candidate, after));
                    if (closer) {
                        this.pos = after + closer.length;
                        return { shape, label: text.slice(cursor, quoteEnd + 1) };
                    }
                }
            }
            let best = -1;
            let bestCloser = '';
            for (const closer of closers) {
                const index = this.indexFrom(closer, this.pos + open.length);
                if (index !== -1 && (best === -1 || index < best)) {
                    best = index;
                    bestCloser = closer;
                }
            }
            if (best === -1 || best - (this.pos + open.length) > MAX_LABEL) continue;
            const label = text.slice(this.pos + open.length, best);
            this.pos = best + bestCloser.length;
            return { shape, label };
        }
        this.pos = save;
        return null;
    }

    findClose(char, from) {
        let quote = false;
        const limit = Math.min(this.text.length, from + MAX_SHAPE_BODY);
        for (let index = from; index < limit; index += 1) {
            const current = this.text[index];
            if (current === '"') quote = !quote;
            else if (current === char && !quote) return index;
        }
        return -1;
    }

    readClasses() {
        const classes = [];
        while (this.text.startsWith(':::', this.pos)) {
            this.pos += 3;
            const start = this.pos;
            while (this.pos < this.text.length && /[\w-]/.test(this.text[this.pos])) this.pos += 1;
            if (this.pos > start) classes.push(this.text.slice(start, this.pos));
        }
        return classes;
    }

    readNode() {
        this.skip();
        const id = this.readId();
        if (!id) return null;
        const shape = this.readShape();
        const classes = this.readClasses();
        return { id, shape: shape?.shape, label: shape?.label, classes };
    }

    readNodeGroup() {
        const first = this.readNode();
        if (!first) return null;
        const group = [first];
        for (;;) {
            const save = this.pos;
            this.skip();
            if (this.text[this.pos] !== '&') {
                this.pos = save;
                break;
            }
            this.pos += 1;
            const next = this.readNode();
            if (!next) return null;
            group.push(next);
        }
        return group;
    }

    boundaryAt(index) {
        const char = this.text[index];
        return char === undefined || /[\s|]/.test(char);
    }

    readArrow() {
        const { text } = this;
        let pos = this.pos;
        let start = '';
        if ('<xo'.includes(text[pos]) && (text[pos + 1] === '-' || text[pos + 1] === '=')) {
            start = text[pos];
            pos += 1;
        }
        if (!start && text.startsWith('~~~', pos)) {
            while (text[pos] === '~') pos += 1;
            return { end: pos, kind: 'invisible', start: '', head: '' };
        }
        const char = text[pos];
        if (char === '-' && text[pos + 1] === '.') {
            let cursor = pos + 1;
            while (text[cursor] === '.') cursor += 1;
            if (text[cursor] === '-') {
                cursor += 1;
                let head = '';
                if (text[cursor] === '>') head = text[cursor++];
                else if ((text[cursor] === 'x' || text[cursor] === 'o') && this.boundaryAt(cursor + 1)) head = text[cursor++];
                return { end: cursor, kind: 'dotted', start, head };
            }
            return { end: pos + 2, kind: 'dotted', start, open: true };
        }
        if ((char === '-' || char === '=') && text[pos + 1] === char) {
            let cursor = pos;
            while (text[cursor] === char) cursor += 1;
            const count = cursor - pos;
            const kind = char === '-' ? 'solid' : 'thick';
            if (text[cursor] === '>') return { end: cursor + 1, kind, start, head: '>' };
            if ((text[cursor] === 'x' || text[cursor] === 'o') && this.boundaryAt(cursor + 1)) return { end: cursor + 1, kind, start, head: text[cursor] };
            if (count >= 3) return { end: cursor, kind, start, head: '' };
            return { end: cursor, kind, start, open: true };
        }
        return null;
    }

    readLink() {
        this.skip();
        const edgeId = this.hasEdgeIds ? /^[A-Za-z0-9_]+@(?=[-=.~<xo])/.exec(this.text.slice(this.pos, this.pos + 90)) : null;
        if (edgeId) this.pos += edgeId[0].length;
        const arrow = this.readArrow();
        if (!arrow) return null;
        this.pos = arrow.end;
        if (arrow.open) {
            const closers = { solid: /-{2,}[>xo-]?/g, thick: /={2,}[>xo=]?/g, dotted: /\.+-[>xo]?/g };
            const pattern = closers[arrow.kind];
            pattern.lastIndex = this.pos;
            const match = pattern.exec(this.text);
            if (!match) return null;
            const label = this.text.slice(this.pos, match.index);
            this.pos = match.index + match[0].length;
            const last = match[0][match[0].length - 1];
            const head = '>xo'.includes(last) ? last : '';
            return { kind: arrow.kind, start: arrow.start, head, label };
        }
        let label;
        const save = this.pos;
        this.skip();
        if (this.text[this.pos] === '|') {
            const end = this.text.indexOf('|', this.pos + 1);
            if (end !== -1) {
                label = this.text.slice(this.pos + 1, end);
                this.pos = end + 1;
            } else this.pos = save;
        } else this.pos = save;
        return { kind: arrow.kind, start: arrow.start, head: arrow.head, label };
    }
}

function edgeAttributes(link, warnings) {
    if ('xo'.includes(link.start) && link.start) warnings.add('approximated_arrow', `Arrow "${link.start}" shown as a regular arrow`);
    if ('xo'.includes(link.head) && link.head) warnings.add('approximated_arrow', `Arrow "${link.head}" shown as a regular arrow`);
    const startArrow = Boolean(link.start);
    const endArrow = Boolean(link.head);
    const arrow = startArrow && endArrow ? 'both' : startArrow ? 'start' : endArrow ? 'end' : 'none';
    const style = link.kind === 'thick' ? 'thick' : link.kind === 'dotted' ? 'dotted' : 'solid';
    return { arrow, style };
}

function styleColor(declarations) {
    if (!declarations) return undefined;
    return chromaticColor(declarations.fill) ?? chromaticColor(declarations.stroke) ?? chromaticColor(declarations.color);
}

function parseFlowchart(header, body, meta, warnings, options) {
    const direction = own(DIRECTION_MAP, (header.rest.trim().split(/[\s;]/)[0] || '').toUpperCase()) ?? 'TB';
    const remainder = header.rest.trim().replace(/^(TB|TD|BT|LR|RL)\b/i, '').replace(/^\s*;/, '');
    const statements = collectAccessibility(splitStatements(joinMultilineStrings([remainder, ...body]), true), meta);

    const entries = new Map();
    const order = [];
    const subgraphs = [];
    const stack = [];
    const groupStack = [];
    let ignoredSubgraphs = 0;
    const classDefs = new Map();
    const links = [];
    const linkStyles = new Map();
    let groupsBudget = LIMITS.groups;
    let edgesFull = false;

    const entry = (raw) => {
        let current = entries.get(raw);
        if (!current) {
            current = { raw, classes: [], mentioned: entries.size };
            entries.set(raw, current);
            order.push(raw);
        }
        return current;
    };
    const mention = (node) => {
        const current = entry(node.id);
        if (node.shape) current.shape = node.shape;
        if (node.label !== undefined) current.label = node.label;
        for (const name of node.classes) current.classes.push(name);
        const owner = groupStack[groupStack.length - 1];
        if (owner) owner.members.push(node.id);
        return current;
    };

    for (const statement of statements) {
        const text = statement.trim();
        if (!text) continue;
        let match;
        if (FLOW_KEYWORDS.has(/^[A-Za-z]+/.exec(text)?.[0])) {
            if ((match = /^subgraph(?:\s+(.*))?$/.exec(text))) {
                if (stack.length >= MAX_SUBGRAPH_STACK) {
                    ignoredSubgraphs += 1;
                    warnings.add('flattened_groups', 'Some subgraphs were merged into their parent');
                    continue;
                }
                const spec = (match[1] ?? '').trim();
                let raw;
                let title;
                const bracket = /^([^\s[]+)\s*\[(.*)\]$/.exec(spec);
                if (bracket) {
                    raw = bracket[1];
                    title = cleanText(bracket[2]);
                } else if (/^"[^"]*"$/.test(spec)) {
                    title = cleanText(spec);
                    raw = title;
                } else {
                    raw = spec || `subgraph-${subgraphs.length + 1}`;
                    title = cleanText(spec);
                }
                const flatten = groupStack.length >= LIMITS.depth || groupsBudget <= 0;
                if (flatten) warnings.add('flattened_groups', 'Some subgraphs were merged into their parent');
                const record = { raw, title, members: [], flatten, parent: groupStack[groupStack.length - 1]?.raw };
                if (!flatten) {
                    groupsBudget -= 1;
                    subgraphs.push(record);
                    entry(raw).subgraph = record;
                    groupStack.push(record);
                }
                stack.push(record);
                continue;
            }
            if (text === 'end') {
                if (ignoredSubgraphs > 0) {
                    ignoredSubgraphs -= 1;
                    continue;
                }
                const record = stack.pop();
                if (!record) {
                    warnings.add('unsupported_syntax', 'Unexpected "end"');
                    continue;
                }
                if (record.flatten) continue;
                groupStack.pop();
                for (const raw of record.members) {
                    const current = entries.get(raw);
                    if (current && !current.subgraph && current.group === undefined) current.group = record.raw;
                }
                continue;
            }
            if (/^direction\s+\w+$/i.test(text)) continue;
            if ((match = /^classDef\s+(\S+)\s+(.+)$/.exec(text))) {
                const declarations = parseCssDeclarations(match[2]);
                for (const name of match[1].split(',')) classDefs.set(name.trim(), declarations);
                continue;
            }
            if ((match = /^class\s+(\S+)\s+([\w-]+)$/.exec(text))) {
                for (const raw of match[1].split(',')) entry(raw.trim()).classes.push(match[2]);
                continue;
            }
            if ((match = /^style\s+(\S+)\s+(.+)$/.exec(text))) {
                entry(match[1]).style = parseCssDeclarations(match[2]);
                continue;
            }
            if ((match = /^linkStyle\s+(\S+)\s+(.+)$/.exec(text))) {
                const color = styleColor(parseCssDeclarations(match[2]));
                for (const index of match[1].split(',')) linkStyles.set(index.trim(), color);
                continue;
            }
            if ((match = /^click\s+(\S+)\s+(.*)$/.exec(text))) {
                const target = entry(match[1]);
                const args = match[2].trim();
                const parts = /^(?:href\s+)?"([^"]*)"(?:\s+"([^"]*)")?/.exec(args);
                if (!parts) {
                    warnings.add('unsupported_click', 'Click callbacks are ignored');
                    continue;
                }
                const href = safeHref(parts[1]);
                if (!href) {
                    warnings.add('unsafe_link', 'A link with an unsupported scheme was removed');
                    continue;
                }
                target.link = { href, label: clip(parts[2] ? cleanText(parts[2]) : undefined, 80) };
                continue;
            }

        }
        const scanner = new Scanner(text);
        let previous = scanner.readNodeGroup();
        if (!previous) {
            warnings.add('unsupported_syntax', clip(text, 80));
            continue;
        }
        previous.forEach(mention);
        while (!scanner.done()) {
            const link = scanner.readLink();
            const next = link ? scanner.readNodeGroup() : null;
            if (!link || !next) {
                warnings.add('unsupported_syntax', clip(text, 80));
                break;
            }
            next.forEach(mention);
            pairs: for (const from of previous) {
                for (const to of next) {
                    if (links.length >= LIMITS.edges) {
                        if (!edgesFull) warnings.add('limit_exceeded', `Only the first ${LIMITS.edges} edges were kept`);
                        edgesFull = true;
                        break pairs;
                    }
                    links.push(link.kind === 'invisible' ? null : { from: from.id, to: to.id, label: link.label, ...edgeAttributes(link, warnings) });
                }
            }
            previous = next;
        }
    }

    while (stack.length) {
        const record = stack.pop();
        warnings.add('unsupported_syntax', 'A subgraph was not closed');
        if (!record.flatten) {
            for (const raw of record.members) {
                const current = entries.get(raw);
                if (current && !current.subgraph && current.group === undefined) current.group = record.raw;
            }
        }
    }

    const ids = createIdFactory('node');
    const idOf = new Map();
    let nodeBudget = LIMITS.nodes;
    for (const raw of order) {
        if (!entries.get(raw).subgraph) {
            if (nodeBudget <= 0) continue;
            nodeBudget -= 1;
        }
        idOf.set(raw, ids.id(raw));
    }

    const colorFor = (current) => {
        const explicit = styleColor(current.style);
        if (explicit) return explicit;
        for (let index = current.classes.length - 1; index >= 0; index -= 1) {
            const color = styleColor(classDefs.get(current.classes[index]));
            if (color) return color;
        }
        return styleColor(classDefs.get('default'));
    };

    const groups = subgraphs.map((record) => {
        const current = entries.get(record.raw);
        if (current.label !== undefined || current.shape) warnings.add('ignored_node', `"${clip(record.raw, 40)}" is a subgraph and a node`);
        return {
            id: idOf.get(record.raw),
            title: clip(record.title, 120) ?? clip(record.raw, 120) ?? fallbackText(options.lang, 'group'),
            parent: record.parent ? idOf.get(record.parent) : undefined,
            color: colorFor(current),
            link: current.link
        };
    });

    const nodes = [];
    for (const raw of order) {
        const current = entries.get(raw);
        if (current.subgraph) continue;
        if (nodes.length >= LIMITS.nodes) {
            warnings.add('limit_exceeded', `Only the first ${LIMITS.nodes} nodes were kept`);
            break;
        }
        const label = current.label !== undefined ? cleanText(current.label) : '';
        const text = splitLabel(label || raw);
        const node = { id: idOf.get(raw), title: text.title ?? clip(raw, 120), shape: current.shape ?? 'card' };
        if (text.subtitle) node.subtitle = text.subtitle;
        if (text.description) node.description = text.description;
        const color = colorFor(current);
        if (color) node.color = color;
        if (current.group !== undefined) node.group = idOf.get(current.group);
        if (current.link) node.link = current.link;
        nodes.push(node);
    }
    const kept = new Set([...nodes.map((node) => node.id), ...groups.map((group) => group.id)]);

    const edges = [];
    links.forEach((link, index) => {
        if (!link) return;
        const from = idOf.get(link.from);
        const to = idOf.get(link.to);
        if (!kept.has(from) || !kept.has(to)) return;
        const edge = { from, to, style: link.style, arrow: link.arrow };
        const label = link.label !== undefined ? singleLine(cleanText(link.label)) : '';
        if (label) {
            edge.label = clip(label, 80);
            if (label.length > 80) edge.description = clip(label, LIMITS.longText);
        }
        const color = linkStyles.get(String(index)) ?? linkStyles.get('default');
        if (color) edge.color = color;
        edges.push(edge);
    });

    return { kind: 'graph', direction, groups, nodes, edges };
}

const MESSAGE_ARROWS = [
    ['<<-->>', 'reply'], ['<<->>', 'sync'], ['-->>', 'reply'], ['->>', 'sync'], ['--x', 'reply'], ['--)', 'async'],
    ['-->', 'reply'], ['-x', 'sync'], ['-)', 'async'], ['->', 'sync']
];
const BLOCK_OPEN = /^(loop|alt|opt|par|critical|break)\b\s*(.*)$/;
const BLOCK_BRANCH = /^(else|and|option)\b\s*(.*)$/;
const PARTICIPANT_TYPES = { actor: 'actor', database: 'store', collections: 'store', entity: 'store', queue: 'queue', boundary: 'system', control: 'system', participant: 'system' };

function parseMessage(text) {
    let index = 0;
    while (index < text.length && !'-<>:,;+'.includes(text[index])) index += 1;
    const from = text.slice(0, index).trim();
    if (!from) return null;
    const arrow = MESSAGE_ARROWS.find(([token]) => text.startsWith(token, index));
    if (!arrow) return null;
    index += arrow[0].length;
    while (text[index] === ' ') index += 1;
    if (text[index] === '+' || text[index] === '-') index += 1;
    const colon = text.indexOf(':', index);
    const to = (colon === -1 ? text.slice(index) : text.slice(index, colon)).trim();
    if (!to || /[<>,;]/.test(to)) return null;
    return { from, to, style: arrow[1], label: colon === -1 ? '' : text.slice(colon + 1) };
}

function parseSequence(header, body, meta, warnings) {
    const statements = collectAccessibility(splitStatements([header.rest, ...body], true), meta);
    const ids = createIdFactory('participant');
    const participants = new Map();
    const root = [];
    const stack = [{ type: 'root', items: root, depth: 0 }];
    let count = 0;
    let full = false;
    let autonumber = false;

    const ensure = (raw, title, kind) => {
        const key = raw.trim();
        let participant = participants.get(key);
        if (!participant) {
            if (participants.size >= 60) {
                warnings.add('limit_exceeded', 'Only the first 60 participants were kept');
                return null;
            }
            participant = { id: ids.id(key), title: clip(title ? cleanText(title) : cleanText(key), 80) ?? clip(key, 80), kind: kind ?? 'system' };
            participants.set(key, participant);
        } else {
            if (title) participant.title = clip(cleanText(title), 80) ?? participant.title;
            if (kind) participant.kind = kind;
        }
        return participant;
    };
    const current = () => stack[stack.length - 1];
    const push = (item) => {
        if (count >= LIMITS.items) {
            if (!full) warnings.add('limit_exceeded', `Only the first ${LIMITS.items} sequence items were kept`);
            full = true;
            return false;
        }
        count += 1;
        current().items.push(item);
        return true;
    };

    for (const statement of statements) {
        const text = statement.trim();
        if (!text) continue;
        let match;
        if ((match = /^(?:create\s+)?(participant|actor)\s+(.+)$/i.exec(text))) {
            let rest = match[2].trim();
            let kind = match[1].toLowerCase() === 'actor' ? 'actor' : undefined;
            const metaIndex = rest.indexOf('@{');
            if (metaIndex !== -1) {
                const type = /"?type"?\s*:\s*"?(\w+)"?/.exec(rest.slice(metaIndex));
                if (type) kind = own(PARTICIPANT_TYPES, type[1].toLowerCase()) ?? kind;
                rest = rest.slice(0, metaIndex).trim();
            }
            const words = rest.split(/\s+/);
            const as = words.indexOf('as', 1);
            ensure(as > 0 ? words.slice(0, as).join(' ') : rest, as > 0 ? words.slice(as + 1).join(' ') || undefined : undefined, kind);
            continue;
        }
        if (/^(destroy|activate|deactivate)\s+/i.test(text)) continue;
        if (/^autonumber\b/i.test(text)) {
            autonumber = true;
            continue;
        }
        if ((match = /^title(?:\s*:\s*|\s+)(.+)$/i.exec(text))) {
            meta.title ??= match[1];
            continue;
        }
        if ((match = /^links?\s+([^:\s][^:]*):\s*(.+)$/i.exec(text))) {
            const participant = ensure(match[1]);
            const value = match[2].trim();
            let label;
            let href;
            const json = /^\{\s*"([^"]*)"\s*:\s*"([^"]*)"/.exec(value);
            const at = value.lastIndexOf('@');
            if (json) [label, href] = [json[1], json[2]];
            else if (at !== -1) [label, href] = [value.slice(0, at).trim(), value.slice(at + 1).trim()];
            const safe = safeHref(href);
            if (participant && safe && !participant.link) participant.link = { href: safe, label: clip(cleanText(label), 80) };
            else if (href && !safe) warnings.add('unsafe_link', 'A link with an unsupported scheme was removed');
            continue;
        }
        if (/^(properties|details)\s+/i.test(text)) continue;
        if ((match = /^note\s+(left of|right of|over)\s+([^:\s][^:]*):(.*)$/i.exec(text))) {
            const over = match[2].split(',').slice(0, 2).map((name) => ensure(name)).filter(Boolean).map((participant) => participant.id);
            const note = clip(cleanText(match[3]), 400);
            if (over.length && note) push({ type: 'note', over: [...new Set(over)], text: note });
            continue;
        }
        if (/^(box|rect)\b/i.test(text)) {
            stack.push({ type: 'transparent', items: current().items, depth: current().depth });
            continue;
        }
        if ((match = BLOCK_OPEN.exec(text))) {
            const parent = current();
            if (parent.depth + 1 > LIMITS.depth) {
                warnings.add('flattened_blocks', 'Some nested blocks were merged into their parent');
                stack.push({ type: 'transparent', items: parent.items, depth: parent.depth });
                continue;
            }
            const block = { type: 'block', kind: match[1], label: clip(cleanText(match[2]), 120), items: [], branches: [] };
            if (!push(block)) {
                stack.push({ type: 'transparent', items: [], depth: parent.depth });
                continue;
            }
            stack.push({ type: 'block', block, items: block.items, depth: parent.depth + 1 });
            continue;
        }
        if ((match = BLOCK_BRANCH.exec(text))) {
            const open = current();
            if (open.type !== 'block') {
                if (open.type !== 'transparent') warnings.add('unsupported_syntax', clip(text, 80));
                continue;
            }
            if (open.block.branches.length >= 12) {
                warnings.add('limit_exceeded', 'Only the first 12 branches of a block were kept');
                continue;
            }
            const branch = { label: clip(cleanText(match[2]), 120), items: [] };
            open.block.branches.push(branch);
            open.items = branch.items;
            continue;
        }
        if (text === 'end') {
            if (stack.length > 1) stack.pop();
            else warnings.add('unsupported_syntax', 'Unexpected "end"');
            continue;
        }
        const message = parseMessage(text);
        if (message) {
            const from = ensure(message.from);
            const to = ensure(message.to);
            if (!from || !to) continue;
            const label = singleLine(cleanText(message.label));
            const item = { type: 'message', from: from.id, to: to.id, style: message.style };
            if (label) {
                item.label = clip(label, 160);
                if (label.length > 160) item.description = clip(label, LIMITS.longText);
            }
            push(item);
            continue;
        }
        warnings.add('unsupported_syntax', clip(text, 80));
    }
    if (stack.length > 1) warnings.add('unsupported_syntax', 'A block was not closed');
    return { kind: 'sequence', participants: [...participants.values()], items: root, autonumber };
}

const CARDINALITY_SYMBOL = { '||': '1', '|o': '0..1', 'o|': '0..1', '}|': '1..N', '|{': '1..N', '}o': '0..N', 'o{': '0..N' };
const CARDINALITY_WORDS = [
    ['only one', '1'], ['exactly one', '1'], ['zero or one', '0..1'], ['one or zero', '0..1'], ['one or more', '1..N'], ['one or many', '1..N'],
    ['many(1)', '1..N'], ['1+', '1..N'], ['zero or more', '0..N'], ['zero or many', '0..N'], ['many(0)', '0..N'], ['0+', '0..N'], ['1', '1']
];
const SYMBOL_RELATION = /(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)/;
const ENTITY_NAME = /^(?:"([^"]+)"|([A-Za-z_\u00c0-\uffff][\w\u00c0-\uffff-]*))/;

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORDS_PATTERN = CARDINALITY_WORDS.map(([word]) => escapeRegex(word)).join('|');
const WORD_RELATION = new RegExp(`\\s(${WORDS_PATTERN})\\s+(to|optionally to)\\s+(${WORDS_PATTERN})\\s`, 'i');

function parseAttribute(source) {
    const text = source.trim();
    let base = text;
    let note;
    if (text.endsWith('"')) {
        const open = text.lastIndexOf('"', text.length - 2);
        if (open !== -1) {
            note = text.slice(open + 1, -1);
            base = text.slice(0, open);
        }
    }
    const parts = base.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const [type, name, ...rest] = parts;
    const keys = rest.join(' ').split(/[\s,]+/).map((key) => key.toLowerCase()).filter((key) => ['pk', 'fk', 'uk'].includes(key));
    const field = { name: clip(name.replace(/^\*/, ''), 80), type: clip(type, 60) };
    if (keys.length) field.key = keys[0];
    if (note) field.note = clip(note, 200);
    return field.name ? field : null;
}

function parseEr(header, body, meta, warnings) {
    const statements = collectAccessibility([header.rest, ...body], meta);
    const entities = new Map();
    const relations = [];
    let direction = 'TB';
    let open = null;

    const entity = (raw) => {
        let current = entities.get(raw);
        if (!current) {
            if (entities.size >= LIMITS.nodes) {
                warnings.add('limit_exceeded', `Only the first ${LIMITS.nodes} entities were kept`);
                return null;
            }
            current = { raw, fields: [] };
            entities.set(raw, current);
        }
        return current;
    };
    const addField = (target, line) => {
        if (!target || !line.trim()) return;
        const field = parseAttribute(line);
        if (!field) {
            warnings.add('unsupported_syntax', clip(line.trim(), 80));
            return;
        }
        if (target.fields.length >= LIMITS.fields) {
            warnings.add('limit_exceeded', `Only the first ${LIMITS.fields} attributes were kept`);
            return;
        }
        target.fields.push(field);
    };

    for (const statement of statements) {
        const text = statement.trim();
        if (!text) continue;
        if (open !== null) {
            const close = text.indexOf('}');
            addField(open, close === -1 ? text : text.slice(0, close));
            if (close !== -1) open = null;
            continue;
        }
        let match;
        if ((match = /^direction\s+(\w+)$/i.exec(text))) {
            direction = own(DIRECTION_MAP, match[1].toUpperCase()) ?? direction;
            continue;
        }
        const name = ENTITY_NAME.exec(text);
        if (name) {
            const raw = name[1] ?? name[2];
            const after = text.slice(name[0].length).trim();
            const block = /^(?:\[([^\]]*)\])?\s*\{(.*)$/.exec(after);
            if (block) {
                const current = entity(raw);
                const alias = unquote(block[1] ?? '');
                if (current && alias) current.title = alias;
                const inline = block[2];
                const close = inline.indexOf('}');
                if (close === -1) {
                    addField(current, inline);
                    open = current ?? false;
                } else {
                    for (const part of inline.slice(0, close).split(/\s{2,}|\n/)) addField(current, part);
                }
                continue;
            }
            if (!after) {
                entity(raw);
                continue;
            }
        }
        const symbol = SYMBOL_RELATION.exec(text);
        const words = symbol ? null : WORD_RELATION.exec(` ${text} `);
        if (symbol || words) {
            const left = (symbol ? text.slice(0, symbol.index) : ` ${text} `.slice(0, words.index)).trim();
            const rightText = (symbol ? text.slice(symbol.index + symbol[0].length) : ` ${text} `.slice(words.index + words[0].length)).trim();
            const rightName = ENTITY_NAME.exec(rightText);
            const leftName = ENTITY_NAME.exec(left);
            if (!leftName || !rightName) {
                warnings.add('unsupported_syntax', clip(text, 80));
                continue;
            }
            const labelPart = rightText.slice(rightName[0].length).trim();
            const label = labelPart.startsWith(':') ? unquote(labelPart.slice(1)) : '';
            const from = entity(leftName[1] ?? leftName[2]);
            const to = entity(rightName[1] ?? rightName[2]);
            if (!from || !to) continue;
            const cardinality = symbol
                ? `${own(CARDINALITY_SYMBOL, symbol[1])} : ${own(CARDINALITY_SYMBOL, symbol[3])}`
                : `${CARDINALITY_WORDS.find(([word]) => word === words[1].toLowerCase())?.[1]} : ${CARDINALITY_WORDS.find(([word]) => word === words[3].toLowerCase())?.[1]}`;
            const dashed = symbol ? symbol[2] === '..' : words[2].toLowerCase() === 'optionally to';
            if (relations.length < LIMITS.edges) relations.push({ from: from.raw, to: to.raw, label, cardinality, dashed });
            else warnings.add('limit_exceeded', `Only the first ${LIMITS.edges} relationships were kept`);
            continue;
        }
        warnings.add('unsupported_syntax', clip(text, 80));
    }

    const ids = createIdFactory('entity');
    const nodes = [...entities.values()].map((current) => {
        const node = { id: ids.id(current.raw), title: clip(cleanText(current.title ?? current.raw), 120) ?? clip(current.raw, 120), shape: 'table' };
        if (current.fields.length) node.fields = current.fields;
        return node;
    });
    const edges = relations.map((relation) => {
        const edge = { from: ids.id(relation.from), to: ids.id(relation.to), arrow: 'none', style: relation.dashed ? 'dashed' : 'solid', description: relation.cardinality };
        const label = singleLine(cleanText(relation.label));
        if (label) edge.label = clip(label, 80);
        return edge;
    });
    return { kind: 'graph', direction, nodes, edges };
}

export function parseMermaid(source, options = {}) {
    const warnings = new Warnings();
    const { lines: body, meta } = preprocess(source);
    const header = locateHeader(body);
    if (!header) throw new ImportError('empty', 'No Mermaid diagram found');
    const type = own(SUPPORTED, header.keyword);
    if (!type) throw new ImportError('unsupported_format', `Mermaid diagram type "${clip(header.keyword, 40)}" is not supported`);
    const rest = body.slice(header.index + 1);
    const content = type === 'flowchart'
        ? parseFlowchart(header, rest, meta, warnings, options)
        : type === 'sequence'
            ? parseSequence(header, rest, meta, warnings)
            : parseEr(header, rest, meta, warnings);
    if (content.kind === 'graph' && !content.nodes.length) throw new ImportError('empty', 'The Mermaid diagram has no nodes');
    if (content.kind === 'sequence' && !content.participants.length) throw new ImportError('empty', 'The Mermaid diagram has no participants');
    const title = clip(meta.title ? cleanText(meta.title) : options.title, 120) ?? fallbackText(options.lang, 'diagram');
    const diagram = { id: options.id ?? title, title, ...content };
    const description = clip(meta.description ? cleanText(meta.description) : options.description, LIMITS.longText);
    if (description) diagram.description = description;
    return { diagram, explicitTitle: Boolean(meta.title), warnings: warnings.list };
}

export function importMermaid(source, options = {}) {
    const { diagram, warnings } = parseMermaid(source, options);
    const collected = new Warnings();
    collected.merge(warnings);
    const set = buildSet({ title: options.setTitle ?? diagram.title, lang: options.lang ?? 'es', diagrams: [diagram] }, collected);
    return { set, warnings: collected.list };
}
