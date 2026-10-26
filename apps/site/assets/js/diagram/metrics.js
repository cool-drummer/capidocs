export const FONTS = {
    sans: 'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
};

export const METRICS = {
    padding: 32,
    card: {
        minWidth: 176,
        maxWidth: 248,
        padX: 12,
        padY: 10,
        radius: 12,
        icon: 28,
        iconGap: 10,
        chevron: 16,
        statusDot: 6,
        title: { size: 13, weight: 600, line: 18, family: 'sans' },
        subtitle: { size: 11.5, weight: 400, line: 16, family: 'mono' },
        badge: { size: 11, weight: 500, height: 18, padX: 8, family: 'sans' },
        divider: 9,
        row: { size: 12, weight: 400, line: 18, gap: 2, family: 'sans' },
        rowLabel: { size: 12, weight: 400, line: 18, family: 'sans', min: 56, max: 104, gap: 12 },
        preview: { height: 56, title: 16, gap: 6 },
        maxValueLines: 3,
        maxTitleLines: 2,
        maxSubtitleLines: 2
    },
    table: {
        minWidth: 200,
        maxWidth: 300,
        header: 34,
        row: 22,
        padX: 12,
        title: { size: 13, weight: 600, line: 18, family: 'sans' },
        field: { size: 12, weight: 400, line: 18, family: 'mono' },
        type: { size: 11.5, weight: 400, line: 18, family: 'mono' },
        key: 22,
        gap: 16,
        radius: 12
    },
    tile: {
        size: 64,
        radius: 14,
        icon: 28,
        labelGap: 6,
        labelMaxWidth: 136,
        labelPadX: 8,
        labelPadY: 4,
        labelRadius: 8,
        label: { size: 12, weight: 500, line: 16, family: 'sans' },
        maxLabelLines: 3
    },
    pill: { height: 32, padX: 14, minWidth: 72, maxWidth: 220, title: { size: 12.5, weight: 600, line: 16, family: 'sans' } },
    diamond: { minWidth: 112, minHeight: 72, maxTextWidth: 140, title: { size: 12.5, weight: 600, line: 16, family: 'sans' } },
    circle: { min: 56, maxTextWidth: 96, title: { size: 12, weight: 600, line: 16, family: 'sans' } },
    cylinder: { cap: 10 },
    actor: { figureWidth: 28, figureHeight: 40, labelGap: 6, maxTextWidth: 120, title: { size: 12, weight: 500, line: 16, family: 'sans' } },
    note: { width: 200, padX: 12, padY: 10, radius: 10, text: { size: 12, weight: 400, line: 17, family: 'sans' }, maxLines: 12 },
    text: { maxWidth: 240, title: { size: 13, weight: 500, line: 18, family: 'sans' } },
    group: {
        pad: 18,
        radius: 18,
        chip: { height: 28, padX: 10, icon: 16, gap: 6, chevron: 14, radius: 9, title: { size: 12.5, weight: 600, family: 'sans' } },
        collapsedPad: 4
    },
    lane: { header: 48, pad: 20, radius: 18, gap: 12, icon: 18, title: { size: 13, weight: 600, family: 'sans' } },
    edge: {
        width: 1.5,
        thick: 2.5,
        radius: 8,
        arrow: 7,
        label: { size: 11, weight: 500, height: 20, padX: 8, radius: 10, family: 'sans' }
    },
    sequence: {
        participant: { minWidth: 120, maxWidth: 180, height: 44, padX: 12, gap: 40, title: { size: 12.5, weight: 600, line: 16, family: 'sans' }, subtitle: { size: 11, weight: 400, line: 14, family: 'mono' } },
        messageGap: 40,
        selfWidth: 36,
        selfHeight: 28,
        block: { pad: 10, header: 22, label: { size: 11, weight: 600, family: 'sans' } },
        note: { maxWidth: 200, padX: 10, padY: 8, text: { size: 11.5, weight: 400, line: 16, family: 'sans' } },
        number: 18
    },
    spacing: {
        compact: { rank: 64, node: 20, group: 32 },
        comfortable: { rank: 96, node: 32, group: 48 }
    }
};

export function cssFont(font) {
    return `${font.weight ?? 400} ${font.size}px ${FONTS[font.family ?? 'sans']}`;
}

const NARROW = /[ilj.,:;'|!()[\]{}`]/;
const WIDE = /[MWmw@%&]/;

export function approximateMeasure(text, font) {
    const size = font.size;
    if (font.family === 'mono') return text.length * size * 0.6;
    const bold = (font.weight ?? 400) >= 600 ? 1.04 : 1;
    let width = 0;
    for (const char of text) {
        if (char === ' ') width += 0.28;
        else if (NARROW.test(char)) width += 0.3;
        else if (WIDE.test(char)) width += 0.82;
        else if (char >= 'A' && char <= 'Z') width += 0.66;
        else if (char >= '0' && char <= '9') width += 0.58;
        else width += 0.54;
    }
    return width * size * bold;
}

export function createCanvasMeasure(doc = globalThis.document) {
    const canvas = doc?.createElement?.('canvas');
    const context = canvas?.getContext?.('2d');
    if (!context) return approximateMeasure;
    const cache = new Map();
    return (text, font) => {
        const key = `${cssFont(font)}|${text}`;
        let width = cache.get(key);
        if (width === undefined) {
            context.font = cssFont(font);
            width = context.measureText(text).width;
            if (cache.size > 20000) cache.clear();
            cache.set(key, width);
        }
        return width;
    };
}

function ellipsize(line, maxWidth, font, measure) {
    let result = line;
    while (result.length > 1 && measure(`${result}…`, font) > maxWidth) result = result.slice(0, -1);
    return `${result.trimEnd()}…`;
}

function breakWord(word, maxWidth, font, measure) {
    const parts = [];
    let current = '';
    for (const char of word) {
        if (current && measure(current + char, font) > maxWidth) {
            parts.push(current);
            current = char;
        } else {
            current += char;
        }
    }
    if (current) parts.push(current);
    return parts;
}

export function wrapText(text, maxWidth, font, measure = approximateMeasure, maxLines = Infinity) {
    if (!text) return [];
    const lines = [];
    for (const paragraph of String(text).split(/\n/)) {
        let current = '';
        for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
            const words = measure(rawWord, font) > maxWidth ? breakWord(rawWord, maxWidth, font, measure) : [rawWord];
            for (const word of words) {
                const candidate = current ? `${current} ${word}` : word;
                if (current && measure(candidate, font) > maxWidth) {
                    lines.push(current);
                    current = word;
                } else {
                    current = candidate;
                }
            }
        }
        lines.push(current);
    }
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxWidth, font, measure);
        return kept;
    }
    return lines;
}

const widest = (lines, font, measure) => lines.reduce((max, line) => Math.max(max, measure(line, font)), 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function isExpandable(node) {
    return Boolean(node.props?.length || node.preview?.values?.length);
}

function cardSize(node, measure, expanded) {
    const m = METRICS.card;
    const iconSpace = node.icon ? m.icon + m.iconGap : 0;
    const trailing = isExpandable(node) ? m.chevron + 8 : 0;
    const statusSpace = node.status ? m.statusDot + 6 : 0;
    const chrome = m.padX * 2 + iconSpace + trailing + statusSpace;
    const natural = Math.max(
        measure(node.title, m.title),
        node.subtitle ? measure(node.subtitle, m.subtitle) : 0,
        node.badge ? measure(node.badge.text, m.badge) + m.badge.padX * 2 - chrome + m.padX * 2 + 24 : 0
    );
    const propLabelWidth = node.props?.length
        ? clamp(Math.ceil(widest(node.props.map((prop) => prop.label), m.rowLabel, measure)), m.rowLabel.min, m.rowLabel.max)
        : 0;
    const propsNatural = node.props?.length
        ? m.padX * 2 + propLabelWidth + m.rowLabel.gap + Math.min(170, node.props.reduce((max, prop) => Math.max(max, measure(prop.value, prop.mono ? { ...m.row, family: 'mono', size: 11.5 } : m.row)), 0))
        : 0;
    const width = node.w ?? clamp(Math.ceil(Math.max(natural + chrome, propsNatural)), m.minWidth, m.maxWidth);
    const textWidth = width - chrome;
    const title = wrapText(node.title, textWidth, m.title, measure, m.maxTitleLines);
    const subtitle = wrapText(node.subtitle, textWidth, m.subtitle, measure, m.maxSubtitleLines);
    const headerText = title.length * m.title.line + subtitle.length * m.subtitle.line + (subtitle.length ? 2 : 0);
    let height = m.padY * 2 + Math.max(headerText, node.icon ? m.icon : 0);

    const props = [];
    let preview = null;
    if (expanded && isExpandable(node)) {
        const labelWidth = propLabelWidth;
        const valueWidth = width - m.padX * 2 - labelWidth - m.rowLabel.gap;
        height += m.divider * 2;
        for (const prop of node.props) {
            const valueFont = prop.mono ? { ...m.row, family: 'mono', size: 11.5 } : m.row;
            const label = wrapText(prop.label, labelWidth, m.rowLabel, measure, 2);
            const value = wrapText(prop.value, valueWidth, valueFont, measure, m.maxValueLines);
            const lines = Math.max(label.length, value.length);
            props.push({ label, value, labelWidth, valueWidth, height: lines * m.row.line + m.row.gap });
            height += lines * m.row.line + m.row.gap;
        }
        if (node.preview?.values?.length) {
            preview = { height: m.preview.height, title: node.preview.title ? m.preview.title : 0 };
            height += (node.props.length ? m.preview.gap : 0) + preview.height + preview.title;
        }
        height += m.padY - m.row.gap;
    }
    return { w: width, h: node.h ?? Math.ceil(height), text: { title, subtitle, props, preview } };
}

function tableSize(node, measure) {
    const m = METRICS.table;
    const nameWidth = widest(node.fields.map((field) => field.name), m.field, measure);
    const typeWidth = widest(node.fields.map((field) => field.type ?? ''), m.type, measure);
    const natural = Math.max(measure(node.title, m.title) + m.padX * 2, m.padX * 2 + m.key + nameWidth + m.gap + typeWidth);
    const width = node.w ?? clamp(Math.ceil(natural), m.minWidth, m.maxWidth);
    const title = wrapText(node.title, width - m.padX * 2, m.title, measure, 1);
    const fields = node.fields.map((field) => ({
        name: wrapText(field.name, width - m.padX * 2 - m.key - m.gap - Math.min(typeWidth, width * 0.4), m.field, measure, 1)[0] ?? '',
        type: field.type ? wrapText(field.type, Math.min(typeWidth, width * 0.4), m.type, measure, 1)[0] : '',
        key: field.key
    }));
    return { w: width, h: node.h ?? m.header + Math.max(1, fields.length) * m.row + 6, text: { title, subtitle: [], fields } };
}

function tileSize(node, measure) {
    const m = METRICS.tile;
    const label = wrapText(node.title, m.labelMaxWidth - m.labelPadX * 2, m.label, measure, m.maxLabelLines);
    const labelWidth = Math.ceil(widest(label, m.label, measure)) + m.labelPadX * 2;
    const labelHeight = label.length * m.label.line + m.labelPadY * 2;
    const width = node.w ?? Math.max(m.size, labelWidth);
    return { w: width, h: node.h ?? m.size + m.labelGap + labelHeight, text: { title: label, subtitle: [], label: { w: labelWidth, h: labelHeight } } };
}

function pillSize(node, measure) {
    const m = METRICS.pill;
    const title = wrapText(node.title, m.maxWidth - m.padX * 2, m.title, measure, 1);
    const width = node.w ?? clamp(Math.ceil(widest(title, m.title, measure) + m.padX * 2), m.minWidth, m.maxWidth);
    return { w: width, h: node.h ?? m.height, text: { title, subtitle: [] } };
}

function diamondSize(node, measure) {
    const m = METRICS.diamond;
    const title = wrapText(node.title, m.maxTextWidth, m.title, measure, 3);
    const textWidth = widest(title, m.title, measure);
    const textHeight = title.length * m.title.line;
    return {
        w: node.w ?? Math.max(m.minWidth, Math.ceil(textWidth * 1.7 + 24)),
        h: node.h ?? Math.max(m.minHeight, Math.ceil(textHeight * 1.9 + 20)),
        text: { title, subtitle: [] }
    };
}

function circleSize(node, measure) {
    const m = METRICS.circle;
    const title = wrapText(node.title, m.maxTextWidth, m.title, measure, 3);
    const diameter = Math.max(m.min, Math.ceil(Math.hypot(widest(title, m.title, measure), title.length * m.title.line) + 16));
    return { w: node.w ?? diameter, h: node.h ?? diameter, text: { title, subtitle: [] } };
}

function actorSize(node, measure) {
    const m = METRICS.actor;
    const title = wrapText(node.title, m.maxTextWidth, m.title, measure, 2);
    const width = Math.max(m.figureWidth, Math.ceil(widest(title, m.title, measure)));
    return { w: node.w ?? width, h: node.h ?? m.figureHeight + m.labelGap + title.length * m.title.line, text: { title, subtitle: [] } };
}

function noteSize(node, measure) {
    const m = METRICS.note;
    const width = node.w ?? m.width;
    const body = node.description ?? node.subtitle ?? '';
    const title = wrapText(node.title, width - m.padX * 2, { ...m.text, weight: 600 }, measure, 2);
    const lines = wrapText(body, width - m.padX * 2, m.text, measure, m.maxLines);
    return { w: width, h: node.h ?? m.padY * 2 + (title.length + lines.length) * m.text.line + (lines.length ? 4 : 0), text: { title, subtitle: [], body: lines } };
}

function textSize(node, measure) {
    const m = METRICS.text;
    const title = wrapText(node.title, m.maxWidth, m.title, measure, 4);
    return { w: node.w ?? Math.ceil(widest(title, m.title, measure)), h: node.h ?? title.length * m.title.line, text: { title, subtitle: [] } };
}

/**
 * @typedef {{ title: string[], subtitle: string[], props?: object[], preview?: object|null, fields?: object[], label?: { w: number, h: number }, body?: string[] }} NodeText
 * @returns {{ w: number, h: number, text: NodeText }}
 */
export function nodeSize(node, { measure = approximateMeasure, expanded = false } = {}) {
    switch (node.shape) {
        case 'table': return tableSize(node, measure);
        case 'tile': return tileSize(node, measure);
        case 'pill': return pillSize(node, measure);
        case 'diamond': return diamondSize(node, measure);
        case 'circle': return circleSize(node, measure);
        case 'actor': return actorSize(node, measure);
        case 'note': return noteSize(node, measure);
        case 'text': return textSize(node, measure);
        case 'cylinder': {
            const size = cardSize({ ...node, props: [], preview: undefined }, measure, false);
            return { ...size, h: node.h ?? size.h + METRICS.cylinder.cap * 2 };
        }
        default: return cardSize(node, measure, expanded);
    }
}

export function groupChipSize(group, measure = approximateMeasure) {
    const m = METRICS.group.chip;
    const titleWidth = measure(group.title, m.title);
    return { w: Math.ceil(m.padX * 2 + (group.icon ? m.icon + m.gap : 0) + titleWidth + m.gap + m.chevron), h: m.height };
}

export function edgeLabelSize(label, measure = approximateMeasure) {
    const m = METRICS.edge.label;
    return { w: Math.ceil(measure(label, m) + m.padX * 2), h: m.height };
}
