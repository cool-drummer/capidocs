import { DIAGRAM_VERSION, LIMITS } from '../model.js';

export class ImportError extends Error {
    constructor(code, detail, issues) {
        super(detail || code);
        this.name = 'ImportError';
        this.code = code;
        this.detail = detail || code;
        if (issues) this.issues = issues;
    }
}

const MAX_WARNINGS = 100;

export class Warnings {
    constructor() {
        this.list = [];
        this.keys = new Set();
        this.overflow = false;
    }

    add(code, detail = '') {
        const key = `${code}\u0000${detail}`;
        if (this.keys.has(key)) return;
        if (this.list.length >= MAX_WARNINGS) {
            if (!this.overflow) this.list.push({ code: 'too_many_warnings', detail: `More than ${MAX_WARNINGS} warnings` });
            this.overflow = true;
            return;
        }
        this.keys.add(key);
        this.list.push({ code, detail });
    }

    merge(entries) {
        for (const entry of entries) this.add(entry.code, entry.detail);
    }
}

const FALLBACK_TEXT = {
    es: { set: 'Diagramas', diagram: 'Diagrama', group: 'Grupo', node: 'Elemento' },
    en: { set: 'Diagrams', diagram: 'Diagram', group: 'Group', node: 'Item' }
};

export function fallbackText(lang, key) {
    const table = FALLBACK_TEXT[String(lang || 'es').slice(0, 2).toLowerCase()] ?? FALLBACK_TEXT.es;
    return table[key];
}

export function slugify(raw, fallback = 'item', { lower = false } = {}) {
    const source = String(raw ?? '');
    const value = (lower ? source.toLowerCase() : source)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_.:-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 64)
        .replace(/[-_.:]+$/, '');
    return value || fallback;
}

export function createIdFactory(fallback = 'item', options = {}) {
    const byKey = new Map();
    const taken = new Set();
    const claim = (base) => {
        let next = base;
        let suffix = 2;
        while (taken.has(next)) next = `${base}-${suffix++}`;
        taken.add(next);
        return next;
    };
    return {
        id(raw) {
            const key = String(raw ?? '');
            if (byKey.has(key)) return byKey.get(key);
            const next = claim(slugify(key, fallback, options));
            byKey.set(key, next);
            return next;
        },
        has(raw) {
            return byKey.has(String(raw ?? ''));
        },
        fresh(base) {
            return claim(slugify(base, fallback, options));
        }
    };
}

export function clip(value, max) {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    if (!text) return undefined;
    if (text.length <= max) return text;
    let cut = text.slice(0, Math.max(1, max - 1));
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}\u2026`;
}

export function lines(text) {
    return String(text ?? '')
        .split('\n')
        .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
        .filter(Boolean);
}

export function splitLabel(text, { title = 120, subtitle = 160 } = {}) {
    const parts = lines(text);
    if (!parts.length) return { title: undefined };
    const [first, ...rest] = parts;
    const result = { title: clip(first, title) };
    const remainder = rest.join(' ');
    const extra = first.length > title ? [first, ...rest] : rest;
    if (first.length > title) {
        result.description = clip(extra.join('\n'), LIMITS.longText);
    } else if (remainder && remainder.length <= subtitle) {
        result.subtitle = remainder;
    } else if (remainder) {
        result.description = clip(rest.join('\n'), LIMITS.longText);
    }
    return result;
}

export function singleLine(text) {
    return lines(text).join(' ');
}

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    iexcl: '\u00a1', iquest: '\u00bf', cent: '\u00a2', pound: '\u00a3', euro: '\u20ac', yen: '\u00a5', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', middot: '\u00b7', bull: '\u2022', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', sect: '\u00a7', para: '\u00b6',
    larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', harr: '\u2194', rArr: '\u21d2', lArr: '\u21d0', check: '\u2713', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
    zwj: '', zwnj: '', shy: '', ordf: '\u00aa', ordm: '\u00ba', sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be', micro: '\u00b5',
    aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', yacute: '\u00fd', Aacute: '\u00c1', Eacute: '\u00c9', Iacute: '\u00cd', Oacute: '\u00d3', Uacute: '\u00da', Yacute: '\u00dd',
    agrave: '\u00e0', egrave: '\u00e8', igrave: '\u00ec', ograve: '\u00f2', ugrave: '\u00f9', Agrave: '\u00c0', Egrave: '\u00c8', Igrave: '\u00cc', Ograve: '\u00d2', Ugrave: '\u00d9',
    acirc: '\u00e2', ecirc: '\u00ea', icirc: '\u00ee', ocirc: '\u00f4', ucirc: '\u00fb', Acirc: '\u00c2', Ecirc: '\u00ca', Icirc: '\u00ce', Ocirc: '\u00d4', Ucirc: '\u00db',
    auml: '\u00e4', euml: '\u00eb', iuml: '\u00ef', ouml: '\u00f6', uuml: '\u00fc', yuml: '\u00ff', Auml: '\u00c4', Euml: '\u00cb', Iuml: '\u00cf', Ouml: '\u00d6', Uuml: '\u00dc',
    atilde: '\u00e3', otilde: '\u00f5', ntilde: '\u00f1', Atilde: '\u00c3', Otilde: '\u00d5', Ntilde: '\u00d1', ccedil: '\u00e7', Ccedil: '\u00c7', szlig: '\u00df',
    aring: '\u00e5', Aring: '\u00c5', aelig: '\u00e6', AElig: '\u00c6', oslash: '\u00f8', Oslash: '\u00d8'
};

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

function fromCodePoint(value) {
    if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(value);
}

export function namedEntity(name) {
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : undefined;
}

export function decodeHtmlEntities(value) {
    const text = String(value ?? '');
    if (!text.includes('&')) return text;
    return text.replace(ENTITY, (match, hex, decimal, name) => {
        if (hex) return fromCodePoint(parseInt(hex, 16));
        if (decimal) return fromCodePoint(parseInt(decimal, 10));
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match;
    });
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'ul', 'ol', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'blockquote', 'pre', 'hr', 'dt', 'dd']);
const RAW_TAGS = new Set(['script', 'style', 'template', 'textarea', 'title', 'noscript', 'iframe', 'object', 'svg', 'math']);

export function asciiLower(value) {
    return value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

export function htmlToText(html) {
    const source = String(html ?? '');
    if (!source.includes('<') && !source.includes('&')) return source;
    const lower = asciiLower(source);
    let result = '';
    let pos = 0;
    while (pos < source.length) {
        const lt = source.indexOf('<', pos);
        if (lt === -1) {
            result += decodeHtmlEntities(source.slice(pos));
            break;
        }
        result += decodeHtmlEntities(source.slice(pos, lt));
        if (source.startsWith('<!--', lt)) {
            const end = source.indexOf('-->', lt + 4);
            pos = end === -1 ? source.length : end + 3;
            continue;
        }
        const match = /^<\/?([a-z][a-z0-9-]*)/.exec(lower.slice(lt, lt + 40));
        if (!match) {
            result += '<';
            pos = lt + 1;
            continue;
        }
        const end = source.indexOf('>', lt);
        if (end === -1) {
            result += decodeHtmlEntities(source.slice(lt));
            break;
        }
        const name = match[1];
        const closing = lower[lt + 1] === '/';
        if (!closing && RAW_TAGS.has(name) && source[end - 1] !== '/') {
            const close = lower.indexOf(`</${name}`, end);
            const closeEnd = close === -1 ? -1 : source.indexOf('>', close);
            pos = closeEnd === -1 ? source.length : closeEnd + 1;
            continue;
        }
        if (name === 'br' || BLOCK_TAGS.has(name)) result += '\n';
        pos = end + 1;
    }
    return result.replace(/\u00a0/g, ' ');
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:|#)[^\s<>"'`]*$/i;

export function safeHref(value) {
    const href = String(value ?? '').trim();
    if (!href || href.length > 2000 || !SAFE_HREF.test(href)) return undefined;
    return href;
}

const PALETTE_HUES = [
    ['red', 0], ['orange', 25], ['amber', 40], ['lime', 84], ['green', 142], ['teal', 173],
    ['sky', 199], ['blue', 217], ['indigo', 239], ['violet', 258], ['pink', 330]
];

const NAMED_COLORS = {
    red: '#ff0000', orange: '#ffa500', yellow: '#ffff00', gold: '#ffd700', lime: '#00ff00', green: '#008000', teal: '#008080',
    cyan: '#00ffff', aqua: '#00ffff', blue: '#0000ff', navy: '#000080', indigo: '#4b0082', purple: '#800080', violet: '#ee82ee',
    magenta: '#ff00ff', fuchsia: '#ff00ff', pink: '#ffc0cb', brown: '#a52a2a', maroon: '#800000', olive: '#808000',
    white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', silver: '#c0c0c0', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    lightblue: '#add8e6', lightgreen: '#90ee90', salmon: '#fa8072', coral: '#ff7f50', tomato: '#ff6347', orchid: '#da70d6',
    skyblue: '#87ceeb', steelblue: '#4682b4', royalblue: '#4169e1', turquoise: '#40e0d0', khaki: '#f0e68c', crimson: '#dc143c'
};

export function parseColor(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text || text === 'none' || text === 'default' || text === 'transparent' || text === 'inherit') return null;
    const named = NAMED_COLORS[text];
    const hex = /^#([0-9a-f]{3,8})$/.exec(named ?? text);
    if (hex) {
        const digits = hex[1];
        if (digits.length === 3 || digits.length === 4) {
            return { r: parseInt(digits[0] + digits[0], 16), g: parseInt(digits[1] + digits[1], 16), b: parseInt(digits[2] + digits[2], 16) };
        }
        if (digits.length === 6 || digits.length === 8) {
            return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
        }
        return null;
    }
    const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(text);
    if (rgb) return { r: Math.min(255, +rgb[1]), g: Math.min(255, +rgb[2]), b: Math.min(255, +rgb[3]) };
    return null;
}

export function chromaticColor(value) {
    const color = parseColor(value);
    if (!color) return undefined;
    const r = color.r / 255;
    const g = color.g / 255;
    const b = color.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) return undefined;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < 0.12 || lightness > 0.97 || lightness < 0.06) return undefined;
    let hue;
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
    let best = PALETTE_HUES[0];
    let bestDistance = Infinity;
    for (const entry of PALETTE_HUES) {
        const distance = Math.min(Math.abs(hue - entry[1]), 360 - Math.abs(hue - entry[1]));
        if (distance < bestDistance) {
            best = entry;
            bestDistance = distance;
        }
    }
    return best[0];
}

export function parseCssDeclarations(text) {
    const result = Object.create(null);
    for (const part of String(text ?? '').split(/[,;]/)) {
        const index = part.indexOf(':');
        if (index === -1) continue;
        const key = part.slice(0, index).trim().toLowerCase();
        const value = part.slice(index + 1).trim();
        if (key && value && !Object.prototype.hasOwnProperty.call(result, key)) result[key] = value;
    }
    return result;
}

export function finiteNumber(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

export function clampNumber(value, min, max) {
    if (value === undefined) return undefined;
    return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

export function buildSet({ title, description, lang = 'es', diagrams }, warnings) {
    const ids = createIdFactory('diagram', { lower: true });
    if (diagrams.length > LIMITS.diagrams) warnings?.add('limit_exceeded', `Only the first ${LIMITS.diagrams} diagrams were kept`);
    const kept = diagrams.slice(0, LIMITS.diagrams).map((diagram) => ({ ...diagram, id: ids.fresh(diagram.id ?? diagram.title) }));
    const set = {
        version: DIAGRAM_VERSION,
        title: clip(title, 120) ?? clip(kept[0]?.title, 120) ?? fallbackText(lang, 'set'),
        lang,
        diagrams: kept
    };
    const text = clip(description, LIMITS.longText);
    if (text) set.description = text;
    return set;
}

export function exceedsByteLimit(text, limit = LIMITS.fileBytes) {
    if (text.length > limit) return true;
    if (text.length * 3 <= limit) return false;
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            bytes += 4;
            index += 1;
        } else bytes += 3;
        if (bytes > limit) return true;
    }
    return false;
}
