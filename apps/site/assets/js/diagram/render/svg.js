import { BUILTIN_ICONS } from '../icons.js';
import { FONTS, METRICS, approximateMeasure, isExpandable } from '../metrics.js';
import { brandIconColor, colorOf, statusColor, themeTokens } from '../theme.js';
import { serializeDiagramSet } from '../model.js';
import { exportFontCss } from './fonts.js';

const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const BLOCK_COLORS = { loop: 'blue', alt: 'violet', opt: 'teal', par: 'indigo', critical: 'red', break: 'orange' };
const KEY_ICONS = { pk: ['key', 'amber'], fk: ['link', 'blue'], uk: ['fingerprint', 'violet'] };

export function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => XML_ENTITIES[char]);
}

function escapeText(value) {
    return String(value ?? '').replace(/[&<>]/g, (char) => XML_ENTITIES[char]);
}

export const METADATA_ID = 'capidocs-diagram';

function detachLink(link, keep) {
    if (!link?.diagram || keep.has(link.diagram)) return link;
    return link.href ? { href: link.href, label: link.label } : undefined;
}

export function diagramMetadata(set, diagram) {
    if (!set) return '';
    let subset = set;
    if (diagram) {
        const keep = new Set([diagram.id]);
        subset = {
            ...set,
            start: diagram.id,
            diagrams: [{
                ...diagram,
                nodes: diagram.nodes.map((node) => ({ ...node, link: detachLink(node.link, keep) })),
                groups: diagram.groups.map((group) => ({ ...group, link: detachLink(group.link, keep) })),
                participants: diagram.participants.map((participant) => ({ ...participant, link: detachLink(participant.link, keep) }))
            }]
        };
    }
    return `<metadata id="${METADATA_ID}">${escapeText(JSON.stringify(serializeDiagramSet(subset)))}</metadata>`;
}

const num = (value) => {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? '0' : String(rounded);
};

function attrs(map) {
    let result = '';
    for (const [key, value] of Object.entries(map)) {
        if (value === undefined || value === null || value === false) continue;
        result += ` ${key}="${typeof value === 'number' ? num(value) : escapeXml(value)}"`;
    }
    return result;
}

function baseline(top, line, size) {
    return top + line / 2 + size * 0.35;
}

function createContext({ mode, theme, set, accent }) {
    const tokens = themeTokens(theme, accent);
    return {
        mode,
        interactive: mode !== 'export',
        tokens,
        icons: { ...BUILTIN_ICONS, ...(set?.icons ?? {}) },
        texts: [],
        origin: { x: 0, y: 0 }
    };
}

function text(ctx, { x, y, size, weight = 400, family = 'sans', fill, anchor, content, className, extra = {} }) {
    if (!content) return '';
    ctx.texts.push({ x: x + ctx.origin.x, y: y + ctx.origin.y, size, weight, family, text: content, anchor: anchor ?? 'start' });
    return `<text${attrs({
        x, y,
        'font-size': size,
        'font-weight': weight,
        'font-family': FONTS[family] ?? FONTS.sans,
        fill,
        'text-anchor': anchor,
        class: className,
        ...extra
    })}>${escapeXml(content)}</text>`;
}

function lines(ctx, list, { x, top, font, fill, anchor, className }) {
    return list.map((line, index) => text(ctx, {
        x,
        y: baseline(top + index * font.line, font.line, font.size),
        size: font.size,
        weight: font.weight,
        family: font.family,
        fill,
        anchor,
        content: line,
        className
    })).join('');
}

export function iconMarkup(ctx, name, { x, y, size, color, strokeWidth = 2 }) {
    const icon = ctx.icons[name];
    if (!icon) return '';
    const viewBox = icon.viewBox ?? '0 0 24 24';
    const paint = icon.stroke
        ? attrs({ fill: 'none', stroke: color, 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        : attrs({ fill: icon.color ? brandIconColor(ctx.tokens, icon.color) : color });
    const paths = icon.paths.map((d) => `<path${attrs({ d })}/>`).join('');
    return `<svg${attrs({ x, y, width: size, height: size, viewBox, 'aria-hidden': 'true', focusable: 'false', class: 'dg-icon' })}><g${paint}>${paths}</g></svg>`;
}

export function roundedPath(points, radius = METRICS.edge.radius) {
    if (!points.length) return '';
    let d = `M${num(points[0].x)} ${num(points[0].y)}`;
    for (let index = 1; index < points.length - 1; index += 1) {
        const prev = points[index - 1];
        const current = points[index];
        const next = points[index + 1];
        const lengthIn = Math.hypot(current.x - prev.x, current.y - prev.y);
        const lengthOut = Math.hypot(next.x - current.x, next.y - current.y);
        const limitIn = index === 1 ? lengthIn : lengthIn / 2;
        const limitOut = index === points.length - 2 ? lengthOut : lengthOut / 2;
        const r = Math.max(0, Math.min(radius, limitIn, limitOut));
        if (r < 0.5 || lengthIn < 0.01 || lengthOut < 0.01) {
            d += ` L${num(current.x)} ${num(current.y)}`;
            continue;
        }
        const inX = current.x - ((current.x - prev.x) / lengthIn) * r;
        const inY = current.y - ((current.y - prev.y) / lengthIn) * r;
        const outX = current.x + ((next.x - current.x) / lengthOut) * r;
        const outY = current.y + ((next.y - current.y) / lengthOut) * r;
        d += ` L${num(inX)} ${num(inY)} Q${num(current.x)} ${num(current.y)} ${num(outX)} ${num(outY)}`;
    }
    const last = points[points.length - 1];
    d += ` L${num(last.x)} ${num(last.y)}`;
    return d;
}

function trimEnd(points, amount, atStart) {
    const result = points.map((point) => ({ ...point }));
    const [a, b] = atStart ? [result[1], result[0]] : [result[result.length - 2], result[result.length - 1]];
    if (!a || !b) return result;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= amount + 1) return result;
    b.x -= ((b.x - a.x) / length) * amount;
    b.y -= ((b.y - a.y) / length) * amount;
    return result;
}

function arrowHead(tip, from, size, filled) {
    const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const ux = (tip.x - from.x) / length;
    const uy = (tip.y - from.y) / length;
    const half = size * 0.65;
    const bx = tip.x - ux * size;
    const by = tip.y - uy * size;
    const w1 = { x: bx - uy * half, y: by + ux * half };
    const w2 = { x: bx + uy * half, y: by - ux * half };
    return filled
        ? `M${num(tip.x)} ${num(tip.y)} L${num(w1.x)} ${num(w1.y)} L${num(w2.x)} ${num(w2.y)} Z`
        : `M${num(w1.x)} ${num(w1.y)} L${num(tip.x)} ${num(tip.y)} L${num(w2.x)} ${num(w2.y)}`;
}

function dashFor(style) {
    if (style === 'dashed') return '6 5';
    if (style === 'dotted') return '0.5 5';
    return undefined;
}

function nodeColor(node) {
    return node.source.color ?? 'neutral';
}

function hasColor(node) {
    return Boolean(node.source.color);
}

function renderBadge(ctx, node, w) {
    const badge = node.text.badge;
    if (!badge) return '';
    const m = METRICS.card.badge;
    const color = colorOf(ctx.tokens, node.source.badge?.color ?? node.source.color ?? 'neutral');
    const x = w - badge.w - 12;
    const y = -m.height / 2;
    return `<g class="dg-badge"><rect${attrs({ x, y, width: badge.w, height: m.height, rx: m.height / 2, fill: color.tint })}/>${text(ctx, {
        x: x + badge.w / 2, y: baseline(y, m.height, m.size), size: m.size, weight: m.weight, fill: color.text, anchor: 'middle', content: badge.text
    })}</g>`;
}

function iconTile(ctx, name, { x, y, size, color }) {
    const icon = ctx.icons[name];
    if (!icon) return '';
    const tokens = colorOf(ctx.tokens, color);
    const fill = icon.stroke ? tokens.tint : ctx.tokens.inset;
    const glyph = Math.round(size * 0.58);
    return `<rect${attrs({ x, y, width: size, height: size, rx: Math.round(size * 0.3), fill })}/>${iconMarkup(ctx, name, {
        x: x + (size - glyph) / 2, y: y + (size - glyph) / 2, size: glyph, color: tokens.solid
    })}`;
}

function controlButton(ctx, { action, x, y, size, icon, label, rotate, nodeId }) {
    const glyph = iconMarkup(ctx, icon, { x: 0, y: 0, size, color: ctx.tokens.muted, strokeWidth: 2 });
    const transform = rotate ? `translate(${num(x)} ${num(y)}) rotate(${rotate} ${num(size / 2)} ${num(size / 2)})` : `translate(${num(x)} ${num(y)})`;
    if (!ctx.interactive) return `<g${attrs({ transform })}>${glyph}</g>`;
    return `<g${attrs({ class: `dg-control dg-control-${action}`, transform, 'data-action': action, 'data-target': nodeId, role: 'button', 'aria-label': label })}><rect${attrs({ x: -4, y: -4, width: size + 8, height: size + 8, rx: 6, fill: 'transparent', class: 'dg-control-bg' })}/>${glyph}</g>`;
}

function preview(ctx, node, { x, y, w, color }) {
    const data = node.source.preview;
    const m = METRICS.card.preview;
    let markup = '';
    let top = y;
    if (data.title) {
        markup += text(ctx, { x, y: baseline(top, m.title, 11), size: 11, weight: 500, fill: ctx.tokens.muted, content: data.title });
        top += m.title;
    }
    const values = data.values;
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const height = m.height - 8;
    const base = top + 4;
    const tokens = colorOf(ctx.tokens, color);
    if (data.type === 'sparkline' && values.length > 1) {
        const step = w / (values.length - 1);
        const pts = values.map((value, index) => `${num(x + index * step)},${num(base + height - ((value - min) / range) * height)}`);
        const last = pts[pts.length - 1].split(',').map(Number);
        markup += `<polyline${attrs({ points: pts.join(' '), fill: 'none', stroke: tokens.solid, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })}/>`;
        markup += `<circle${attrs({ cx: last[0], cy: last[1], r: 2.5, fill: tokens.solid })}/>`;
    } else {
        const gap = values.length > 24 ? 1 : 3;
        const barWidth = Math.max(1, (w - gap * (values.length - 1)) / values.length);
        values.forEach((value, index) => {
            const barHeight = Math.max(2, ((value - min) / range) * height);
            markup += `<rect${attrs({
                x: x + index * (barWidth + gap), y: base + height - barHeight, width: barWidth, height: barHeight,
                rx: Math.min(2, barWidth / 2), fill: index === values.length - 1 ? tokens.solid : tokens.tint
            })}/>`;
        });
    }
    return markup;
}

function cardBody(ctx, node, { offsetY = 0 } = {}) {
    const m = METRICS.card;
    const source = node.source;
    const color = nodeColor(node);
    const w = node.w;
    const t = node.text;
    const headerText = t.title.length * m.title.line + t.subtitle.length * m.subtitle.line + (t.subtitle.length ? 2 : 0);
    const contentH = Math.max(headerText, source.icon ? m.icon : 0);
    const headerTop = offsetY + m.padY;
    const iconSpace = source.icon ? m.icon + m.iconGap : 0;
    const expandable = isExpandable(source);
    const trailing = (expandable ? m.chevron + 8 : 0) + (source.link ? m.link + 6 : 0);
    const statusSpace = source.status ? m.statusDot + 6 : 0;
    const textX = m.padX + iconSpace;
    const textWidth = w - m.padX * 2 - iconSpace - trailing - statusSpace;
    const textTop = headerTop + (contentH - headerText) / 2;
    let markup = '';
    if (source.icon) markup += iconTile(ctx, source.icon, { x: m.padX, y: headerTop + (contentH - m.icon) / 2, size: m.icon, color });
    markup += lines(ctx, t.title, { x: textX, top: textTop, font: m.title, fill: ctx.tokens.ink });
    markup += lines(ctx, t.subtitle, { x: textX, top: textTop + t.title.length * m.title.line + 2, font: m.subtitle, fill: ctx.tokens.muted });
    const centerY = headerTop + contentH / 2;
    if (source.status) {
        const status = colorOf(ctx.tokens, statusColor(source.status));
        markup += `<circle${attrs({ cx: textX + textWidth + 6 + m.statusDot / 2, cy: centerY, r: m.statusDot / 2, fill: status.solid, class: 'dg-status' })}/>`;
    }
    let controlX = w - m.padX;
    if (expandable) {
        controlX -= m.chevron;
        markup += controlButton(ctx, {
            action: 'toggle-expand', nodeId: node.id, x: controlX, y: centerY - m.chevron / 2, size: m.chevron, icon: 'chevron-down',
            rotate: node.expanded ? 180 : 0, label: node.expanded ? 'collapse' : 'expand'
        });
        controlX -= 8;
    }
    if (source.link) {
        controlX -= m.link;
        markup += controlButton(ctx, {
            action: 'open-link', nodeId: node.id, x: controlX, y: centerY - m.link / 2, size: m.link,
            icon: source.link.href && !source.link.diagram ? 'external-link' : 'arrow-up-right', label: 'open'
        });
    }
    if (node.expanded && expandable) {
        let y = offsetY + m.padY * 2 + contentH;
        markup += `<line${attrs({ x1: m.padX, x2: w - m.padX, y1: y + m.divider, y2: y + m.divider, stroke: ctx.tokens.divider, 'stroke-width': 1, class: 'dg-divider' })}/>`;
        y += m.divider * 2;
        t.props.forEach((row, index) => {
            const prop = source.props[index];
            const valueX = m.padX + row.labelWidth + m.rowLabel.gap;
            const valueFont = prop.mono ? { ...m.row, family: 'mono', size: 11.5 } : m.row;
            const valueFill = prop.status ? colorOf(ctx.tokens, statusColor(prop.status)).text : ctx.tokens.ink;
            markup += lines(ctx, row.label, { x: m.padX, top: y, font: m.rowLabel, fill: ctx.tokens.muted });
            markup += lines(ctx, row.value, { x: valueX, top: y, font: { ...valueFont, line: m.row.line }, fill: valueFill });
            y += row.height;
        });
        if (t.preview) {
            if (t.props.length) y += m.preview.gap;
            markup += preview(ctx, node, { x: m.padX, y, w: w - m.padX * 2, color: source.color ?? 'teal' });
        }
    }
    return markup;
}

function shapeCard(ctx, node) {
    return `<rect${attrs({ width: node.w, height: node.h, rx: METRICS.card.radius, fill: ctx.tokens.surface, class: 'dg-node-bg' })}/>${cardBody(ctx, node)}${renderBadge(ctx, node, node.w)}`;
}

function shapeCylinder(ctx, node) {
    const cap = METRICS.cylinder.cap;
    const { w, h } = node;
    const rx = w / 2;
    const body = `M0 ${num(cap)} A${num(rx)} ${num(cap)} 0 0 1 ${num(w)} ${num(cap)} V${num(h - cap)} A${num(rx)} ${num(cap)} 0 0 1 0 ${num(h - cap)} Z`;
    const top = colorOf(ctx.tokens, nodeColor(node));
    return `<path${attrs({ d: body, fill: ctx.tokens.surface, class: 'dg-node-bg' })}/><ellipse${attrs({ cx: rx, cy: cap, rx, ry: cap, fill: hasColor(node) ? top.tint : ctx.tokens.divider })}/>${cardBody(ctx, node, { offsetY: cap })}${renderBadge(ctx, node, w)}`;
}

function shapeTable(ctx, node) {
    const m = METRICS.table;
    const { w, h } = node;
    const color = colorOf(ctx.tokens, nodeColor(node));
    const r = m.radius;
    const header = `M0 ${r} Q0 0 ${r} 0 H${num(w - r)} Q${num(w)} 0 ${num(w)} ${r} V${m.header} H0 Z`;
    let markup = `<rect${attrs({ width: w, height: h, rx: r, fill: ctx.tokens.surface, class: 'dg-node-bg' })}/>`;
    markup += `<path${attrs({ d: header, fill: hasColor(node) ? color.tint : ctx.tokens.inset })}/>`;
    const iconSize = 14;
    let titleX = m.padX;
    if (node.source.icon) {
        markup += iconMarkup(ctx, node.source.icon, { x: m.padX, y: (m.header - iconSize) / 2, size: iconSize, color: color.solid });
        titleX += iconSize + 8;
    } else {
        markup += iconMarkup(ctx, 'table', { x: m.padX, y: (m.header - iconSize) / 2, size: iconSize, color: hasColor(node) ? color.solid : ctx.tokens.muted });
        titleX += iconSize + 8;
    }
    markup += lines(ctx, node.text.title, { x: titleX, top: (m.header - m.title.line) / 2, font: m.title, fill: ctx.tokens.ink });
    node.text.fields.forEach((field, index) => {
        const top = m.header + 3 + index * m.row;
        if (index > 0) markup += `<line${attrs({ x1: m.padX, x2: w - m.padX, y1: top, y2: top, stroke: ctx.tokens.divider, 'stroke-width': 1, class: 'dg-divider' })}/>`;
        if (field.key && KEY_ICONS[field.key]) {
            const [icon, keyColor] = KEY_ICONS[field.key];
            markup += iconMarkup(ctx, icon, { x: m.padX, y: top + (m.row - 12) / 2, size: 12, color: colorOf(ctx.tokens, keyColor).solid });
        }
        markup += text(ctx, { x: m.padX + m.key, y: baseline(top, m.row, m.field.size), size: m.field.size, weight: field.key === 'pk' ? 600 : 400, family: 'mono', fill: ctx.tokens.ink, content: field.name });
        markup += text(ctx, { x: w - m.padX, y: baseline(top, m.row, m.type.size), size: m.type.size, family: 'mono', fill: ctx.tokens.muted, anchor: 'end', content: field.type });
    });
    return markup;
}

function shapeTile(ctx, node) {
    const m = METRICS.tile;
    const color = colorOf(ctx.tokens, nodeColor(node));
    const x = (node.w - m.size) / 2;
    let markup = `<rect${attrs({ x, width: m.size, height: m.size, rx: m.radius, fill: hasColor(node) ? color.tint : ctx.tokens.surface, class: 'dg-node-bg' })}/>`;
    if (node.source.icon) {
        markup += iconMarkup(ctx, node.source.icon, { x: x + (m.size - m.icon) / 2, y: (m.size - m.icon) / 2, size: m.icon, color: color.solid, strokeWidth: 1.75 });
    }
    const label = node.text.label;
    const labelY = m.size + m.labelGap;
    markup += `<rect${attrs({ x: (node.w - label.w) / 2, y: labelY, width: label.w, height: label.h, rx: m.labelRadius, fill: ctx.tokens.surface, class: 'dg-tile-label' })}/>`;
    markup += lines(ctx, node.text.title, { x: node.w / 2, top: labelY + m.labelPadY, font: m.label, fill: ctx.tokens.ink, anchor: 'middle' });
    return markup;
}

function shapePill(ctx, node) {
    const m = METRICS.pill;
    const color = colorOf(ctx.tokens, nodeColor(node));
    return `<rect${attrs({ width: node.w, height: node.h, rx: node.h / 2, fill: hasColor(node) ? color.tint : ctx.tokens.surface, class: 'dg-node-bg' })}/>${lines(ctx, node.text.title, {
        x: node.w / 2, top: (node.h - node.text.title.length * m.title.line) / 2, font: m.title, fill: hasColor(node) ? color.text : ctx.tokens.ink, anchor: 'middle'
    })}`;
}

function shapeDiamond(ctx, node) {
    const m = METRICS.diamond;
    const { w, h } = node;
    const color = colorOf(ctx.tokens, nodeColor(node));
    const r = 6;
    const k = r / Math.hypot(w / 2, h / 2);
    const pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    let d = '';
    pts.forEach((point, index) => {
        const prev = pts[(index + 3) % 4];
        const next = pts[(index + 1) % 4];
        const a = [point[0] + (prev[0] - point[0]) * k, point[1] + (prev[1] - point[1]) * k];
        const b = [point[0] + (next[0] - point[0]) * k, point[1] + (next[1] - point[1]) * k];
        d += `${index ? 'L' : 'M'}${num(a[0])} ${num(a[1])} Q${num(point[0])} ${num(point[1])} ${num(b[0])} ${num(b[1])} `;
    });
    d += 'Z';
    return `<path${attrs({ d, fill: hasColor(node) ? color.tint : ctx.tokens.surface, class: 'dg-node-bg' })}/>${lines(ctx, node.text.title, {
        x: w / 2, top: (h - node.text.title.length * m.title.line) / 2, font: m.title, fill: hasColor(node) ? color.text : ctx.tokens.ink, anchor: 'middle'
    })}`;
}

function shapeCircle(ctx, node) {
    const m = METRICS.circle;
    const color = colorOf(ctx.tokens, nodeColor(node));
    const r = Math.min(node.w, node.h) / 2;
    return `<circle${attrs({ cx: node.w / 2, cy: node.h / 2, r, fill: hasColor(node) ? color.tint : ctx.tokens.surface, class: 'dg-node-bg' })}/>${lines(ctx, node.text.title, {
        x: node.w / 2, top: (node.h - node.text.title.length * m.title.line) / 2, font: m.title, fill: hasColor(node) ? color.text : ctx.tokens.ink, anchor: 'middle'
    })}`;
}

function shapeActor(ctx, node) {
    const m = METRICS.actor;
    const cx = node.w / 2;
    const stroke = hasColor(node) ? colorOf(ctx.tokens, nodeColor(node)).solid : ctx.tokens.ink;
    const figure = [
        `M${num(cx - 6)} 7 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0`,
        `M${num(cx)} 13 V26`,
        `M${num(cx - 11)} 18 H${num(cx + 11)}`,
        `M${num(cx)} 26 L${num(cx - 9)} 38`,
        `M${num(cx)} 26 L${num(cx + 9)} 38`
    ].join(' ');
    return `<rect${attrs({ x: -6, y: -4, width: node.w + 12, height: node.h + 8, rx: 10, fill: 'transparent', class: 'dg-hit' })}/><path${attrs({ d: figure, fill: 'none', stroke, 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'dg-actor' })}/>${lines(ctx, node.text.title, {
        x: cx, top: m.figureHeight + m.labelGap, font: m.title, fill: ctx.tokens.ink, anchor: 'middle'
    })}`;
}

function shapeNote(ctx, node) {
    const m = METRICS.note;
    const color = colorOf(ctx.tokens, node.source.color ?? 'amber');
    const titleFont = { ...m.text, weight: 600 };
    const fold = 12;
    const d = `M0 ${m.radius} Q0 0 ${m.radius} 0 H${num(node.w - fold)} L${num(node.w)} ${fold} V${num(node.h - m.radius)} Q${num(node.w)} ${num(node.h)} ${num(node.w - m.radius)} ${num(node.h)} H${m.radius} Q0 ${num(node.h)} 0 ${num(node.h - m.radius)} Z`;
    let markup = `<path${attrs({ d, fill: color.soft, class: 'dg-node-bg' })}/>`;
    markup += `<path${attrs({ d: `M${num(node.w - fold)} 0 V${fold - 3} Q${num(node.w - fold)} ${fold} ${num(node.w - fold + 3)} ${fold} H${num(node.w)} Z`, fill: color.tint })}/>`;
    markup += lines(ctx, node.text.title, { x: m.padX, top: m.padY, font: titleFont, fill: ctx.tokens.ink });
    markup += lines(ctx, node.text.body ?? [], { x: m.padX, top: m.padY + node.text.title.length * m.text.line + 4, font: m.text, fill: ctx.tokens.muted });
    return markup;
}

function shapeText(ctx, node) {
    return `<rect${attrs({ x: -6, y: -4, width: node.w + 12, height: node.h + 8, rx: 8, fill: 'transparent', class: 'dg-hit' })}/>${lines(ctx, node.text.title, { x: 0, top: 0, font: METRICS.text.title, fill: ctx.tokens.ink })}`;
}

const SHAPES = {
    card: shapeCard,
    cylinder: shapeCylinder,
    table: shapeTable,
    tile: shapeTile,
    pill: shapePill,
    diamond: shapeDiamond,
    circle: shapeCircle,
    actor: shapeActor,
    note: shapeNote,
    text: shapeText
};

function accessibleName(source) {
    return [source.title, source.subtitle].filter(Boolean).join(', ');
}

function withOrigin(ctx, x, y, render) {
    const previous = ctx.origin;
    ctx.origin = { x: previous.x + x, y: previous.y + y };
    try {
        return render();
    } finally {
        ctx.origin = previous;
    }
}

function renderNode(ctx, node) {
    const body = withOrigin(ctx, node.x, node.y, () => (SHAPES[node.shape] ?? shapeCard)(ctx, node));
    const source = node.source;
    const classes = ['dg-node', `dg-shape-${node.shape}`];
    if (source.link) classes.push('dg-has-link');
    if (node.expanded) classes.push('dg-expanded');
    const interactive = ctx.interactive ? {
        tabindex: '-1',
        role: 'button',
        'aria-label': accessibleName(source),
        'aria-expanded': isExpandable(source) ? String(node.expanded) : undefined
    } : {};
    return `<g${attrs({ class: classes.join(' '), 'data-node': node.id, transform: `translate(${num(node.x)} ${num(node.y)})`, ...interactive })}>${body}</g>`;
}

function renderLane(ctx, lane) {
    const m = METRICS.lane;
    const color = colorOf(ctx.tokens, lane.color);
    const fill = lane.color === 'neutral' ? attrs({ fill: ctx.tokens.lane }) : attrs({ fill: color.solid, 'fill-opacity': ctx.tokens.laneOpacity });
    let markup = `<rect${attrs({ x: lane.x, y: lane.y, width: lane.w, height: lane.h, rx: m.radius })}${fill}/>`;
    let x = lane.x + m.pad;
    const centerY = lane.y + m.header / 2 + 2;
    for (const icon of lane.icons) {
        markup += iconMarkup(ctx, icon, { x, y: centerY - m.icon / 2, size: m.icon, color: lane.color === 'neutral' ? ctx.tokens.muted : color.solid });
        x += m.icon + 6;
    }
    if (lane.icons.length) x += 4;
    markup += text(ctx, { x, y: centerY + m.title.size * 0.35, size: m.title.size, weight: m.title.weight, fill: ctx.tokens.ink, content: lane.title });
    return `<g${attrs({ class: 'dg-lane', 'data-lane': lane.id })}>${markup}</g>`;
}

function renderGroupArea(ctx, group) {
    if (group.collapsed) return '';
    const color = colorOf(ctx.tokens, group.color);
    const fill = group.color === 'neutral'
        ? attrs({ fill: ctx.tokens.ink, 'fill-opacity': ctx.tokens.theme === 'dark' ? 0.05 : 0.045 })
        : attrs({ fill: color.solid, 'fill-opacity': ctx.tokens.washOpacity });
    return `<g${attrs({ class: 'dg-group', 'data-group': group.id })}><rect${attrs({ x: group.x, y: group.y, width: group.w, height: group.h, rx: METRICS.group.radius, class: 'dg-group-bg' })}${fill}/></g>`;
}

function renderGroupChip(ctx, group) {
    const m = METRICS.group.chip;
    const header = group.header;
    const color = colorOf(ctx.tokens, group.color);
    const fill = group.collapsed && group.color !== 'neutral' ? color.tint : ctx.tokens.chip;
    let markup = `<rect${attrs({ x: header.x, y: header.y, width: header.w, height: header.h, rx: m.radius, fill, class: 'dg-chip-bg' })}/>`;
    let x = header.x + m.padX;
    const centerY = header.y + header.h / 2;
    if (group.icon) {
        markup += iconMarkup(ctx, group.icon, { x, y: centerY - m.icon / 2, size: m.icon, color: group.color === 'neutral' ? ctx.tokens.muted : color.solid });
        x += m.icon + m.gap;
    }
    markup += text(ctx, { x, y: centerY + m.title.size * 0.35, size: m.title.size, weight: m.title.weight, fill: ctx.tokens.ink, content: group.title });
    const chevronX = header.x + header.w - m.padX - m.chevron;
    markup += iconMarkup(ctx, group.collapsed ? 'chevron-right' : 'chevron-down', { x: chevronX, y: centerY - m.chevron / 2, size: m.chevron, color: ctx.tokens.muted });
    const interactive = ctx.interactive ? {
        tabindex: '-1',
        role: 'button',
        'data-action': 'toggle-group',
        'data-target': group.id,
        'aria-expanded': String(!group.collapsed),
        'aria-label': group.title
    } : {};
    return `<g${attrs({ class: `dg-group-chip${group.collapsed ? ' dg-collapsed' : ''}`, 'data-group': group.id, ...interactive })}>${markup}</g>`;
}

function renderEdge(ctx, edge) {
    if (edge.points.length < 2) return '';
    const m = METRICS.edge;
    const stroke = edge.color ? colorOf(ctx.tokens, edge.color).solid : ctx.tokens.edge;
    const width = edge.style === 'thick' ? m.thick : m.width;
    const arrowEnd = edge.arrow === 'end' || edge.arrow === 'both';
    const arrowStart = edge.arrow === 'start' || edge.arrow === 'both';
    let points = edge.points;
    if (arrowEnd) points = trimEnd(points, 1, false);
    if (arrowStart) points = trimEnd(points, 1, true);
    const d = roundedPath(points);
    let markup = '';
    if (ctx.interactive) markup += `<path${attrs({ d, class: 'dg-edge-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 14 })}/>`;
    markup += `<path${attrs({ d, class: 'dg-edge-line', fill: 'none', stroke, 'stroke-width': width, 'stroke-dasharray': dashFor(edge.style), 'stroke-linecap': edge.style === 'dotted' ? 'round' : 'butt', 'stroke-linejoin': 'round' })}/>`;
    const size = m.arrow + (edge.style === 'thick' ? 1.5 : 0);
    const head = (tip, from) => `<path${attrs({ d: arrowHead(tip, from, size, false), class: 'dg-edge-arrow', fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}/>`;
    const n = edge.points.length;
    if (arrowEnd) markup += head(edge.points[n - 1], edge.points[n - 2]);
    if (arrowStart) markup += head(edge.points[0], edge.points[1]);
    const classes = ['dg-edge'];
    if (edge.color) classes.push(`dg-edge-colored`);
    return `<g${attrs({ class: classes.join(' '), 'data-edge': edge.id, 'data-from': edge.from, 'data-to': edge.to })}>${markup}</g>`;
}

function renderEdgeLabel(ctx, edge) {
    if (!edge.label || !edge.labelBox) return '';
    if (edge.labelHidden && !ctx.interactive) return '';
    const m = METRICS.edge.label;
    const box = edge.labelBox;
    return `<g${attrs({ class: edge.labelHidden ? 'dg-edge-label dg-label-hidden' : 'dg-edge-label', 'data-edge': edge.id })}><rect${attrs({ x: box.x, y: box.y, width: box.w, height: box.h, rx: m.radius, fill: ctx.tokens.labelBg })}/>${text(ctx, {
        x: box.x + box.w / 2, y: baseline(box.y, box.h, m.size), size: m.size, weight: m.weight, fill: ctx.tokens.labelText, anchor: 'middle', content: edge.label
    })}</g>`;
}

function renderGraph(ctx, scene) {
    const lanes = scene.lanes.map((lane) => renderLane(ctx, lane)).join('');
    const groups = scene.groups.map((group) => renderGroupArea(ctx, group)).join('');
    const edges = scene.edges.map((edge) => renderEdge(ctx, edge)).join('');
    const labels = scene.edges.map((edge) => renderEdgeLabel(ctx, edge)).join('');
    const chips = scene.groups.map((group) => renderGroupChip(ctx, group)).join('');
    const nodes = scene.nodes.map((node) => renderNode(ctx, node)).join('');
    return `<g class="dg-lanes">${lanes}</g><g class="dg-groups">${groups}</g><g class="dg-edges">${edges}</g><g class="dg-labels">${labels}</g><g class="dg-chips">${chips}</g><g class="dg-nodes">${nodes}</g>`;
}

function renderParticipant(ctx, participant) {
    return withOrigin(ctx, participant.x, participant.y, () => participantMarkup(ctx, participant));
}

function participantMarkup(ctx, participant) {
    const pm = METRICS.sequence.participant;
    const color = colorOf(ctx.tokens, participant.color ?? 'neutral');
    const fill = participant.kind === 'external' ? ctx.tokens.lane : ctx.tokens.surface;
    let markup = `<rect${attrs({ width: participant.w, height: participant.h, rx: 12, fill, class: 'dg-node-bg' })}/>`;
    const t = participant.text;
    const textHeight = t.title.length * pm.title.line + t.subtitle.length * pm.subtitle.line;
    const iconSize = 16;
    let x = pm.padX;
    const top = (participant.h - textHeight) / 2;
    if (participant.icon) {
        markup += iconMarkup(ctx, participant.icon, { x, y: (participant.h - iconSize) / 2, size: iconSize, color: participant.color ? color.solid : ctx.tokens.muted });
        x += iconSize + 8;
    }
    markup += lines(ctx, t.title, { x, top, font: pm.title, fill: ctx.tokens.ink });
    markup += lines(ctx, t.subtitle, { x, top: top + t.title.length * pm.title.line, font: pm.subtitle, fill: ctx.tokens.muted });
    if (participant.source.link) {
        const size = 14;
        markup += controlButton(ctx, { action: 'open-link', nodeId: participant.id, x: participant.w - pm.padX - size, y: (participant.h - size) / 2, size, icon: 'arrow-up-right', label: 'open' });
    }
    const interactive = ctx.interactive ? { tabindex: '-1', role: 'button', 'aria-label': accessibleName(participant.source) } : {};
    const classes = ['dg-node', 'dg-participant', `dg-kind-${participant.kind}`];
    if (participant.source.link) classes.push('dg-has-link');
    return `<g${attrs({ class: classes.join(' '), 'data-node': participant.id, transform: `translate(${num(participant.x)} ${num(participant.y)})`, ...interactive })}>${markup}</g>`;
}

function renderMessage(ctx, message, autonumber) {
    const m = METRICS.sequence;
    const stroke = ctx.tokens.ink;
    const dash = message.style === 'reply' ? '5 4' : undefined;
    const filled = message.style === 'sync';
    let markup = '';
    let path;
    let tip;
    let from;
    const numberRadius = m.number / 2;
    if (message.self) {
        const x = message.x1;
        const right = x + m.selfWidth;
        const start = autonumber ? x + numberRadius * 2 + 2 : x;
        path = roundedPath([{ x: start, y: message.y }, { x: right, y: message.y }, { x: right, y: message.y2 }, { x: x + 1, y: message.y2 }], 6);
        tip = { x, y: message.y2 };
        from = { x: right, y: message.y2 };
    } else {
        const direction = message.x2 > message.x1 ? 1 : -1;
        const start = autonumber ? message.x1 + direction * (numberRadius * 2 + 2) : message.x1;
        const end = message.x2 - direction * 1;
        path = `M${num(start)} ${num(message.y)} L${num(end)} ${num(message.y)}`;
        tip = { x: message.x2, y: message.y };
        from = { x: message.x1, y: message.y };
    }
    if (ctx.interactive) markup += `<path${attrs({ d: path, class: 'dg-edge-hit', fill: 'none', stroke: 'transparent', 'stroke-width': 14 })}/>`;
    markup += `<path${attrs({ d: path, class: 'dg-edge-line', fill: 'none', stroke, 'stroke-width': 1.5, 'stroke-dasharray': dash })}/>`;
    markup += `<path${attrs({ d: arrowHead(tip, from, 8, filled), class: 'dg-edge-arrow', fill: filled ? stroke : 'none', stroke, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })}/>`;
    if (autonumber) {
        const direction = message.self || message.x2 > message.x1 ? 1 : -1;
        const cx = message.x1 + direction * (numberRadius + 1);
        markup += `<circle${attrs({ cx, cy: message.y, r: numberRadius, fill: ctx.tokens.ink, class: 'dg-number' })}/>`;
        markup += text(ctx, { x: cx, y: message.y + 3.6, size: 10, weight: 600, fill: ctx.tokens.surface, anchor: 'middle', content: String(message.index) });
    }
    if (message.labelBox && message.lines.length) {
        const box = message.labelBox;
        const font = { size: 12, weight: 500, line: 16, family: 'sans' };
        markup += lines(ctx, message.lines, { x: message.self ? box.x : box.x + box.w / 2, top: box.y, font, fill: ctx.tokens.ink, anchor: message.self ? undefined : 'middle' });
    }
    return `<g${attrs({ class: 'dg-message dg-edge', 'data-message': message.id, 'data-edge': message.id, 'data-from': message.from, 'data-to': message.to })}>${markup}</g>`;
}

function renderBlock(ctx, block) {
    const m = METRICS.sequence.block;
    const color = colorOf(ctx.tokens, BLOCK_COLORS[block.kind] ?? 'neutral');
    let markup = `<rect${attrs({ x: block.x, y: block.y, width: block.w, height: block.h, rx: 10, fill: color.solid, 'fill-opacity': ctx.tokens.theme === 'dark' ? 0.07 : 0.05 })}/>`;
    markup += `<rect${attrs({ x: block.header.x, y: block.header.y, width: block.header.w, height: block.header.h, rx: 6, fill: color.tint })}/>`;
    markup += text(ctx, { x: block.header.x + block.header.w / 2, y: baseline(block.header.y, block.header.h, m.label.size), size: m.label.size, weight: m.label.weight, fill: color.text, anchor: 'middle', content: block.kind });
    if (block.label) markup += text(ctx, { x: block.labelX, y: baseline(block.header.y, block.header.h, m.label.size), size: 11.5, weight: 500, fill: ctx.tokens.muted, content: `[${block.label}]` });
    for (const divider of block.dividers) {
        markup += `<line${attrs({ x1: block.x + 8, x2: block.x + block.w - 8, y1: divider.y, y2: divider.y, stroke: color.solid, 'stroke-opacity': 0.35, 'stroke-width': 1, 'stroke-dasharray': '4 4', class: 'dg-divider' })}/>`;
        if (divider.label) markup += text(ctx, { x: block.x + 12, y: baseline(divider.y + 2, m.header, 11.5), size: 11.5, weight: 500, fill: ctx.tokens.muted, content: `[${divider.label}]` });
    }
    return `<g${attrs({ class: 'dg-block', 'data-block': block.id })}>${markup}</g>`;
}

function renderNote(ctx, note) {
    const m = METRICS.sequence.note;
    const color = colorOf(ctx.tokens, 'amber');
    return `<g${attrs({ class: 'dg-note', 'data-note': note.id })}><rect${attrs({ x: note.x, y: note.y, width: note.w, height: note.h, rx: 8, fill: color.soft })}/>${lines(ctx, note.lines, {
        x: note.x + note.w / 2, top: note.y + m.padY, font: m.text, fill: ctx.tokens.ink, anchor: 'middle'
    })}</g>`;
}

function renderSequence(ctx, scene) {
    const blocks = scene.blocks.map((block) => renderBlock(ctx, block)).join('');
    const lifelines = scene.participants.map((participant) => `<line${attrs({
        x1: participant.lifeline.x, x2: participant.lifeline.x, y1: participant.lifeline.y1, y2: participant.lifeline.y2,
        stroke: ctx.tokens.lifeline, 'stroke-width': 1.25, 'stroke-dasharray': '4 4', class: 'dg-lifeline', 'data-lifeline': participant.id
    })}/>`).join('');
    const notes = scene.notes.map((note) => renderNote(ctx, note)).join('');
    const messages = scene.messages.map((message) => renderMessage(ctx, message, scene.autonumber)).join('');
    const participants = scene.participants.map((participant) => renderParticipant(ctx, participant)).join('');
    return `<g class="dg-blocks">${blocks}</g><g class="dg-lifelines">${lifelines}</g><g class="dg-notes">${notes}</g><g class="dg-edges">${messages}</g><g class="dg-nodes">${participants}</g>`;
}

export function renderSceneContent(scene, options = {}) {
    const ctx = createContext({ mode: options.mode ?? 'interactive', theme: options.theme ?? 'light', set: options.set, accent: options.accent });
    const markup = scene.kind === 'sequence' ? renderSequence(ctx, scene) : renderGraph(ctx, scene);
    return { markup, ctx };
}

export function renderSvg(scene, { mode = 'interactive', theme = 'light', set = null, diagram = null, embedFontCss, accent, title, background = true, metadata = true } = {}) {
    const { markup, ctx } = renderSceneContent(scene, { mode, theme, set, accent });
    const exporting = mode === 'export';
    const fonts = exporting ? (embedFontCss ?? exportFontCss()) : '';
    const head = [];
    if (title) head.push(`<title>${escapeText(title)}</title>`);
    if (exporting && metadata && set) head.push(diagramMetadata(set, diagram));
    if (fonts) head.push(`<style>${escapeText(fonts.replace(/<\/?style[^>]*>/gi, ''))}</style>`);
    const backdrop = exporting && background ? `<rect${attrs({ width: scene.width, height: scene.height, fill: ctx.tokens.canvas })}/>` : '';
    return `<svg${attrs({
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `0 0 ${num(scene.width)} ${num(scene.height)}`,
        width: scene.width,
        height: scene.height,
        class: exporting ? undefined : 'dg-svg',
        role: 'img',
        'aria-label': title,
        'font-family': FONTS.sans,
        'text-rendering': 'geometricPrecision'
    })}>${head.join('')}${backdrop}${markup}</svg>`;
}

export function sceneTexts(scene, options = {}) {
    const { ctx } = renderSceneContent(scene, { ...options, mode: 'export' });
    const measure = options.measure ?? approximateMeasure;
    return ctx.texts.map(({ x, y, size, weight, family, text: content, anchor }) => {
        const width = measure(content, { size, weight, family });
        const start = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
        return { x: Math.round(start * 100) / 100, y: Math.round(y * 100) / 100, size, text: content, width: Math.round(width * 100) / 100 };
    });
}
