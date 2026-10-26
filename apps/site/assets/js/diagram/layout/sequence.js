import { METRICS, approximateMeasure, wrapText } from '../metrics.js';
import { extremes } from './bounds.js';

const KIND_ICONS = { actor: 'user', store: 'database', queue: 'inbox', external: 'globe' };
const LABEL_FONT = { size: 12, weight: 500, line: 16, family: 'sans' };
const LABEL_MAX = 260;
const BLOCK_PAD = 12;
const ICON = 16;

function widest(lines, font, measure) {
    return lines.reduce((max, line) => Math.max(max, measure(line, font)), 0);
}

function walk(items, visit, depth = 0) {
    for (const item of items) {
        visit(item, depth);
        if (item.type === 'block') {
            walk(item.items, visit, depth + 1);
            item.branches.forEach((branch) => walk(branch.items, visit, depth + 1));
        }
    }
}

export function participantIcon(participant) {
    return participant.icon ?? (Object.hasOwn(KIND_ICONS, participant.kind) ? KIND_ICONS[participant.kind] : undefined);
}

export function layoutSequence(diagram, { measure = approximateMeasure } = {}) {
    const m = METRICS.sequence;
    const pm = m.participant;
    const padding = METRICS.padding;
    const index = new Map(diagram.participants.map((participant, position) => [participant.id, position]));

    const heads = diagram.participants.map((participant) => {
        const icon = participantIcon(participant);
        const chrome = pm.padX * 2 + (icon ? ICON + 8 : 0) + (participant.link ? 22 : 0);
        const title = wrapText(participant.title, pm.maxWidth - chrome, pm.title, measure, 2);
        const subtitle = wrapText(participant.subtitle, pm.maxWidth - chrome, pm.subtitle, measure, 1);
        const natural = Math.max(widest(title, pm.title, measure), widest(subtitle, pm.subtitle, measure)) + chrome;
        const w = Math.ceil(Math.min(pm.maxWidth, Math.max(pm.minWidth, natural)));
        const h = Math.max(pm.height, title.length * pm.title.line + subtitle.length * pm.subtitle.line + 16);
        return { participant, icon, title, subtitle, w, h };
    });
    const headHeight = Math.max(pm.height, ...heads.map((head) => head.h));

    const prepared = new Map();
    walk(diagram.items, (item) => {
        if (item.type === 'message') {
            const lines = item.label ? wrapText(item.label, LABEL_MAX, LABEL_FONT, measure, 3) : [];
            prepared.set(item, { lines, width: Math.ceil(widest(lines, LABEL_FONT, measure)) });
        } else if (item.type === 'note') {
            const lines = wrapText(item.text, m.note.maxWidth - m.note.padX * 2, m.note.text, measure, 10);
            prepared.set(item, { lines, width: Math.ceil(widest(lines, m.note.text, measure)) + m.note.padX * 2 });
        }
    });

    const constraints = [];
    for (let i = 0; i + 1 < heads.length; i += 1) constraints.push([i, i + 1, (heads[i].w + heads[i + 1].w) / 2 + pm.gap]);
    const numberSpace = diagram.autonumber ? m.number + 8 : 0;
    walk(diagram.items, (item) => {
        if (item.type === 'message') {
            const a = index.get(item.from);
            const b = index.get(item.to);
            if (a === undefined || b === undefined) return;
            const { width } = prepared.get(item);
            if (a === b) {
                if (a + 1 < heads.length) constraints.push([a, a + 1, m.selfWidth + width + 28]);
            } else {
                constraints.push([Math.min(a, b), Math.max(a, b), width + numberSpace + 36]);
            }
        } else if (item.type === 'note') {
            const refs = item.over.map((ref) => index.get(ref)).filter((value) => value !== undefined);
            if (!refs.length) return;
            const { width } = prepared.get(item);
            if (refs.length === 1 || refs[0] === refs[1]) {
                const at = refs[0];
                if (at > 0) constraints.push([at - 1, at, width / 2 + 24]);
                if (at + 1 < heads.length) constraints.push([at, at + 1, width / 2 + 24]);
            } else {
                constraints.push([Math.min(...refs), Math.max(...refs), width - 48]);
            }
        }
    });
    constraints.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const centers = heads.map((head, position) => (position === 0 ? head.w / 2 : 0));
    for (let i = 1; i < heads.length; i += 1) centers[i] = centers[i - 1];
    for (const [a, b, distance] of constraints) {
        const deficit = distance - (centers[b] - centers[a]);
        if (deficit > 0) for (let k = b; k < centers.length; k += 1) centers[k] += deficit;
    }
    for (let i = 1; i < centers.length; i += 1) centers[i] = Math.max(centers[i], centers[i - 1] + (heads[i - 1].w + heads[i].w) / 2 + pm.gap);
    const left = padding;
    const lifelineX = centers.map((center) => left + center);

    const top = padding;
    const messages = [];
    const notes = [];
    const blocks = [];
    let counter = 0;
    let y = top + headHeight + 28;

    const extentOfMessage = (message) => {
        if (message.self) {
            return { lo: message.x1 - 4, hi: Math.max(message.x1 + m.selfWidth, message.labelBox ? message.labelBox.x + message.labelBox.w : message.x1 + m.selfWidth) };
        }
        return { lo: Math.min(message.x1, message.x2), hi: Math.max(message.x1, message.x2) };
    };

    const layoutItems = (items, depth) => {
        for (const item of items) {
            if (item.type === 'message') {
                const a = index.get(item.from);
                const b = index.get(item.to);
                if (a === undefined || b === undefined) continue;
                counter += 1;
                const { lines, width } = prepared.get(item);
                const labelHeight = lines.length * LABEL_FONT.line;
                const self = a === b;
                const x1 = lifelineX[a];
                const x2 = lifelineX[b];
                let message;
                if (self) {
                    const arrowY = y + 4;
                    const labelBox = lines.length ? { x: x1 + m.selfWidth + 10, y: arrowY + (m.selfHeight - labelHeight) / 2, w: width, h: labelHeight } : undefined;
                    message = { id: item.id, index: counter, from: item.from, to: item.to, y: arrowY, y2: arrowY + m.selfHeight, x1, x2, self: true, label: item.label, lines, labelBox, style: item.style, source: item };
                    y = arrowY + m.selfHeight + 22;
                } else {
                    const arrowY = y + labelHeight + 8;
                    const mid = (x1 + x2) / 2 + (diagram.autonumber ? (x2 > x1 ? numberSpace / 2 : -numberSpace / 2) : 0);
                    const labelBox = lines.length ? { x: mid - width / 2, y: y, w: width, h: labelHeight } : undefined;
                    message = { id: item.id, index: counter, from: item.from, to: item.to, y: arrowY, x1, x2, self: false, label: item.label, lines, labelBox, style: item.style, source: item };
                    y = arrowY + Math.max(20, m.messageGap - labelHeight - 8);
                }
                messages.push(message);
            } else if (item.type === 'note') {
                const refs = item.over.map((ref) => index.get(ref)).filter((value) => value !== undefined);
                if (!refs.length) continue;
                const { lines, width } = prepared.get(item);
                const lo = lifelineX[Math.min(...refs)];
                const hi = lifelineX[Math.max(...refs)];
                const w = Math.max(width, hi - lo + (refs.length > 1 ? 48 : 0), 96);
                const h = lines.length * m.note.text.line + m.note.padY * 2;
                const note = { id: item.id, text: item.text, lines, x: (lo + hi) / 2 - w / 2, y, w, h, over: item.over, source: item };
                notes.push(note);
                y += h + 16;
            } else if (item.type === 'block') {
                const blockTop = y;
                y += m.block.header + 10;
                const dividers = [];
                layoutItems(item.items, depth + 1);
                for (const branch of item.branches) {
                    y += 2;
                    dividers.push({ y, label: branch.label });
                    y += m.block.header + 6;
                    layoutItems(branch.items, depth + 1);
                }
                y += 6;
                const block = { id: item.id, kind: item.kind, label: item.label, depth, y: blockTop, h: y - blockTop, dividers, items: item, x: 0, w: 0 };
                blocks.push(block);
                y += 12;
            }
        }
    };

    layoutItems(diagram.items, 0);

    const blockExtent = (block, item) => {
        const range = { lo: Infinity, hi: -Infinity };
        const absorb = (lo, hi) => {
            range.lo = Math.min(range.lo, lo);
            range.hi = Math.max(range.hi, hi);
        };
        const visit = (items) => {
            for (const child of items) {
                if (child.type === 'message') {
                    const message = messages.find((entry) => entry.source === child);
                    if (!message) continue;
                    const ext = extentOfMessage(message);
                    absorb(ext.lo, ext.hi);
                    if (message.labelBox) absorb(message.labelBox.x, message.labelBox.x + message.labelBox.w);
                } else if (child.type === 'note') {
                    const note = notes.find((entry) => entry.source === child);
                    if (note) absorb(note.x, note.x + note.w);
                } else if (child.type === 'block') {
                    const nested = blocks.find((entry) => entry.items === child);
                    if (nested) absorb(nested.x, nested.x + nested.w);
                }
            }
        };
        visit(item.items);
        item.branches.forEach((branch) => visit(branch.items));
        if (!Number.isFinite(range.lo)) {
            range.lo = lifelineX[0] - 40;
            range.hi = lifelineX[0] + 40;
        }
        const labelWidth = measure(block.label ? `[${block.label}]` : '', m.block.label) + measure(block.kind, m.block.label) + 40;
        const lo = range.lo - BLOCK_PAD - 8;
        const hi = Math.max(range.hi + BLOCK_PAD + 8, lo + labelWidth);
        return { lo, hi };
    };
    const ordered = [...blocks].sort((a, b) => b.depth - a.depth);
    for (const block of ordered) {
        const { lo, hi } = blockExtent(block, block.items);
        block.x = lo;
        block.w = hi - lo;
    }
    for (const block of blocks) {
        const kindWidth = Math.ceil(measure(block.kind, m.block.label)) + 16;
        block.header = { x: block.x, y: block.y, w: kindWidth, h: m.block.header };
        block.labelX = block.x + kindWidth + 8;
        block.source = block.items;
        delete block.items;
    }
    blocks.sort((a, b) => a.depth - b.depth || a.y - b.y);

    const bottom = y + 12;
    const participants = heads.map((head, position) => {
        const x = lifelineX[position] - head.w / 2;
        return {
            id: head.participant.id,
            title: head.participant.title,
            subtitle: head.participant.subtitle,
            kind: head.participant.kind,
            icon: head.icon,
            color: head.participant.color,
            x,
            y: top,
            w: head.w,
            h: headHeight,
            text: { title: head.title, subtitle: head.subtitle },
            lifeline: { x: lifelineX[position], y1: top + headHeight, y2: bottom },
            source: head.participant
        };
    });

    const extents = [
        ...participants.map((p) => ({ lo: p.x, hi: p.x + p.w })),
        ...blocks.map((b) => ({ lo: b.x, hi: b.x + b.w })),
        ...notes.map((n) => ({ lo: n.x, hi: n.x + n.w })),
        ...messages.map((message) => {
            const ext = extentOfMessage(message);
            return message.labelBox ? { lo: Math.min(ext.lo, message.labelBox.x), hi: Math.max(ext.hi, message.labelBox.x + message.labelBox.w) } : ext;
        })
    ];
    const minX = extremes(extents.map((e) => e.lo)).min;
    const maxX = extremes(extents.map((e) => e.hi)).max;
    const shift = padding - minX;
    if (Math.abs(shift) > 0.01) {
        for (const p of participants) { p.x += shift; p.lifeline.x += shift; }
        for (const message of messages) {
            message.x1 += shift;
            message.x2 += shift;
            if (message.labelBox) message.labelBox.x += shift;
        }
        for (const note of notes) note.x += shift;
        for (const block of blocks) { block.x += shift; block.header.x += shift; block.labelX += shift; }
    }

    return {
        kind: 'sequence',
        width: Math.ceil(maxX - minX + padding * 2),
        height: Math.ceil(bottom + padding),
        autonumber: diagram.autonumber,
        participants,
        messages,
        notes,
        blocks
    };
}
