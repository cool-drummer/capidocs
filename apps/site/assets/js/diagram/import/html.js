import { LIMITS } from '../model.js';
import { combineSets } from './combine.js';
import { parseJsonText, setFromJsonValue } from './json.js';
import { parseMermaid } from './mermaid.js';
import { ImportError, Warnings, asciiLower, buildSet, clip, decodeHtmlEntities, htmlToText, lines } from './shared.js';

export const SET_SCRIPT_ID = 'capidocs-diagram-set';
export const SVG_METADATA_ID = 'capidocs-diagram';

const RAW_TEXT = new Set(['style', 'textarea', 'template', 'noscript', 'iframe', 'xmp', 'noembed', 'noframes', 'plaintext']);
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function tagEnd(source, from) {
    let quote = '';
    for (let index = from; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '>') return index;
    }
    return -1;
}

function parseAttributes(text) {
    const attributes = Object.create(null);
    ATTRIBUTE.lastIndex = 0;
    let match;
    while ((match = ATTRIBUTE.exec(text))) {
        const name = asciiLower(match[1]);
        if (Object.hasOwn(attributes, name)) continue;
        attributes[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attributes;
}

function classes(attributes) {
    return new Set(String(attributes.class ?? '').split(/\s+/).filter(Boolean));
}

function closeIndex(lower, name, from) {
    let depth = 1;
    let pos = from;
    const open = `<${name}`;
    const close = `</${name}`;
    let nextOpen = -2;
    let nextClose = -2;
    for (;;) {
        if (nextClose !== -1 && nextClose < pos) nextClose = lower.indexOf(close, pos);
        if (nextClose === -1) return { start: -1, end: lower.length };
        if (nextOpen !== -1 && nextOpen < pos) nextOpen = lower.indexOf(open, pos);
        if (nextOpen !== -1 && nextOpen < nextClose) {
            pos = nextOpen + open.length;
            if (/[\s>/]/.test(lower[pos] ?? '')) depth += 1;
            continue;
        }
        depth -= 1;
        if (depth === 0) {
            const end = lower.indexOf('>', nextClose);
            return { start: nextClose, end: end === -1 ? lower.length : end + 1 };
        }
        pos = nextClose + close.length;
    }
}

function rawClose(lower, name, from) {
    const start = lower.indexOf(`</${name}`, from);
    if (start === -1) return { start: lower.length, end: lower.length };
    const end = lower.indexOf('>', start);
    return { start, end: end === -1 ? lower.length : end + 1 };
}

const BLOCK_START = /<\/?(?:p|pre|div|h[1-6]|ul|ol|li|table|section|article|header|footer|main|nav|aside|script|style|figure|blockquote)[\s>/]/g;

function textBoundary(lower, name, from) {
    BLOCK_START.lastIndex = from;
    const block = BLOCK_START.exec(lower);
    const limit = block ? block.index : lower.length;
    const offset = lower.slice(from, limit + name.length + 2).indexOf(`</${name}`);
    const close = offset === -1 ? -1 : from + offset;
    if (close !== -1 && close <= limit) {
        const end = lower.indexOf('>', close);
        return { start: close, end: end === -1 ? lower.length : end + 1 };
    }
    return { start: limit, end: limit };
}

function stripCdata(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>')) return trimmed.slice(9, -3);
    return decodeHtmlEntities(trimmed);
}

export function scanHtml(source) {
    const text = String(source ?? '');
    const lower = asciiLower(text);
    const result = { setJson: null, title: undefined, description: undefined, firstHeading: undefined, mermaid: [], metadata: [] };
    let heading = null;
    let pos = 0;
    while (pos < text.length) {
        const lt = text.indexOf('<', pos);
        if (lt === -1) break;
        if (text.startsWith('<!--', lt)) {
            const end = text.indexOf('-->', lt + 4);
            pos = end === -1 ? text.length : end + 3;
            continue;
        }
        if (text[lt + 1] === '!' || text[lt + 1] === '?') {
            const end = text.indexOf('>', lt);
            pos = end === -1 ? text.length : end + 1;
            continue;
        }
        const name = /^<\/?([a-z][a-z0-9:-]*)/.exec(lower.slice(lt, lt + 64))?.[1];
        if (!name) {
            pos = lt + 1;
            continue;
        }
        const end = tagEnd(text, lt + 1);
        if (end === -1) break;
        if (text[lt + 1] === '/') {
            pos = end + 1;
            continue;
        }
        const attributes = parseAttributes(text.slice(lt + 1 + name.length, end));
        const after = end + 1;
        const selfClosing = text[end - 1] === '/';

        if (name === 'script') {
            const close = rawClose(lower, 'script', after);
            if (String(attributes.type ?? '').trim().toLowerCase() === 'application/json' && attributes.id === SET_SCRIPT_ID && result.setJson === null) {
                result.setJson = text.slice(after, close.start);
            }
            pos = close.end;
            continue;
        }
        if (RAW_TEXT.has(name)) {
            pos = rawClose(lower, name, after).end;
            continue;
        }
        if (name === 'title' && !selfClosing) {
            const close = rawClose(lower, 'title', after);
            result.title ??= clip(lines(decodeHtmlEntities(text.slice(after, close.start))).join(' '), 120);
            pos = close.end;
            continue;
        }
        if (name === 'metadata' && attributes.id === SVG_METADATA_ID && !selfClosing) {
            const close = rawClose(lower, 'metadata', after);
            result.metadata.push(stripCdata(text.slice(after, close.start)));
            pos = close.end;
            continue;
        }
        const tagClasses = classes(attributes);
        const isMermaid = ((name === 'pre' || name === 'div') && tagClasses.has('mermaid'))
            || ((name === 'code' || name === 'pre') && (tagClasses.has('language-mermaid') || tagClasses.has('lang-mermaid')));
        if (isMermaid && !selfClosing) {
            const close = closeIndex(lower, name, after);
            const inner = text.slice(after, close.start === -1 ? text.length : close.start);
            const highlighted = name === 'code' || tagClasses.has('language-mermaid') || tagClasses.has('lang-mermaid');
            result.mermaid.push({
                source: highlighted ? htmlToText(inner) : decodeHtmlEntities(inner),
                heading: heading ? { title: heading.title, description: heading.description } : null
            });
            if (heading) heading.open = false;
            pos = close.end;
            continue;
        }
        if ((name === 'h1' || name === 'h2') && !selfClosing) {
            const close = textBoundary(lower, name, after);
            const title = clip(lines(htmlToText(text.slice(after, close.start))).join(' '), 120);
            if (title) {
                heading = { title, description: undefined, open: true, first: name === 'h1' && result.firstHeading === undefined };
                if (heading.first) result.firstHeading = title;
            }
            pos = close.end;
            continue;
        }
        if (name === 'p' && heading?.open && !selfClosing) {
            const close = textBoundary(lower, 'p', after);
            const description = clip(lines(htmlToText(text.slice(after, close.start))).join(' '), LIMITS.longText);
            if (description) {
                heading.description = description;
                heading.open = false;
                if (heading.first) result.description = description;
            }
            pos = close.end;
            continue;
        }
        pos = after;
    }
    return result;
}

export function importHtml(source, options = {}) {
    const lang = options.lang ?? 'es';
    const scan = scanHtml(source);
    if (scan.setJson !== null) {
        return { set: setFromJsonValue(parseJsonText(scan.setJson), { title: scan.title ?? options.title, lang }), warnings: [] };
    }
    const warnings = new Warnings();
    const parts = [];
    scan.mermaid.forEach((block, index) => {
        const label = `diagram ${index + 1}`;
        try {
            const parsed = parseMermaid(block.source, { lang });
            warnings.merge(parsed.warnings);
            const diagram = { ...parsed.diagram };
            if (!parsed.explicitTitle && block.heading?.title) {
                diagram.title = block.heading.title;
                diagram.id = block.heading.title;
            }
            if (!diagram.description && block.heading?.description) diagram.description = block.heading.description;
            parts.push({ label, set: buildSet({ title: diagram.title, lang, diagrams: [diagram] }), trusted: true });
        } catch (error) {
            if (!(error instanceof ImportError)) throw error;
            warnings.add('invalid_block', `${label}: ${error.detail}`);
        }
    });
    scan.metadata.forEach((content, index) => {
        const label = `svg ${index + 1}`;
        try {
            parts.push({ label, set: setFromJsonValue(parseJsonText(content), { title: scan.title ?? options.title, lang }) });
        } catch (error) {
            if (!(error instanceof ImportError)) throw error;
            warnings.add('invalid_block', `${label}: ${error.detail}`);
        }
    });
    if (!parts.length) throw new ImportError('empty', 'No diagrams were found in the HTML file');
    const set = combineSets(parts, { title: scan.title ?? scan.firstHeading ?? options.title, description: scan.description, lang }, warnings);
    return { set, warnings: warnings.list, validated: true };
}
