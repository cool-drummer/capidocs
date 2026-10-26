import { LIMITS } from '../model.js';
import { XmlError, attribute, childElements, firstChild, parseXml, rootElement, textContent } from '../xml.js';
import {
    ImportError, Warnings, chromaticColor, clampNumber, clip, createIdFactory, fallbackText, finiteNumber,
    htmlToText, lines, safeHref, singleLine, splitLabel
} from './shared.js';

export const DRAWIO_LIMITS = {
    inflatedBytes: 32 * 1024 * 1024,
    cells: 20000
};

const RESERVED_ATTRIBUTES = new Set(['id', 'label', 'placeholders', 'link', 'tooltip', 'tags', 'linkTarget']);
const PAGE_LINK = /^data:page\/id,(.+)$/;

function base64ToBytes(text) {
    const compact = text.replace(/\s+/g, '');
    if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        throw new ImportError('parse_error', 'Compressed page is not valid base64');
    }
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function inflateRaw(bytes, limit) {
    if (typeof DecompressionStream === 'function') {
        const stream = new DecompressionStream('deflate-raw');
        const writer = stream.writable.getWriter();
        writer.write(bytes).catch(() => {});
        writer.close().catch(() => {});
        const reader = stream.readable.getReader();
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > limit) {
                    await reader.cancel().catch(() => {});
                    throw new ImportError('too_large', 'Compressed page expands beyond the limit');
                }
                chunks.push(value);
            }
        } catch (error) {
            if (error instanceof ImportError) throw error;
            throw new ImportError('parse_error', 'Compressed page could not be inflated');
        }
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return result;
    }
    const zlib = await import('node:zlib');
    try {
        return zlib.inflateRawSync(bytes, { maxOutputLength: limit });
    } catch (error) {
        throw new ImportError(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'too_large' : 'parse_error', 'Compressed page could not be inflated');
    }
}

async function inflatePage(text) {
    const inflated = await inflateRaw(base64ToBytes(text), DRAWIO_LIMITS.inflatedBytes);
    const encoded = new TextDecoder('utf-8').decode(inflated);
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
}

function parseDocument(text) {
    try {
        return parseXml(text, { maxLength: DRAWIO_LIMITS.inflatedBytes });
    } catch (error) {
        if (error instanceof XmlError) throw new ImportError(error.code === 'too_large' ? 'too_large' : 'parse_error', error.detail);
        throw error;
    }
}

function parseStyle(text) {
    const names = new Set();
    const values = Object.create(null);
    for (const part of String(text ?? '').split(';')) {
        const token = part.trim();
        if (!token) continue;
        const index = token.indexOf('=');
        if (index === -1) names.add(token);
        else values[token.slice(0, index).trim()] = token.slice(index + 1).trim();
    }
    return { names, values, shape: String(values.shape ?? '').toLowerCase() };
}

function point(element) {
    const x = finiteNumber(attribute(element, 'x')) ?? 0;
    const y = finiteNumber(attribute(element, 'y')) ?? 0;
    return { x, y };
}

function readGeometry(cell) {
    const candidates = childElements(cell, 'mxGeometry');
    const geometry = candidates.find((element) => attribute(element, 'as') === 'geometry') ?? candidates[0];
    if (!geometry) return null;
    const result = {
        x: finiteNumber(attribute(geometry, 'x')) ?? 0,
        y: finiteNumber(attribute(geometry, 'y')) ?? 0,
        w: finiteNumber(attribute(geometry, 'width')) ?? 0,
        h: finiteNumber(attribute(geometry, 'height')) ?? 0,
        relative: attribute(geometry, 'relative') === '1',
        points: []
    };
    for (const child of childElements(geometry)) {
        const role = attribute(child, 'as');
        if (child.name === 'Array' && role === 'points') result.points = childElements(child, 'mxPoint').slice(0, 64).map(point);
        else if (child.name === 'mxPoint' && role === 'sourcePoint') result.sourcePoint = point(child);
        else if (child.name === 'mxPoint' && role === 'targetPoint') result.targetPoint = point(child);
    }
    return result;
}

function readCells(model, warnings) {
    const root = firstChild(model, 'root');
    if (!root) return [];
    const cells = [];
    const seen = new Set();
    for (const child of childElements(root)) {
        let element = null;
        let wrapper = null;
        if (child.name === 'mxCell') element = child;
        else if (child.name === 'UserObject' || child.name === 'object') {
            wrapper = child;
            element = firstChild(child, 'mxCell');
        }
        if (!element) continue;
        const id = attribute(wrapper ?? element, 'id');
        if (id === undefined) continue;
        if (seen.has(id)) {
            warnings.add('duplicate_cell', 'Cells with a repeated id were ignored');
            continue;
        }
        if (cells.length >= DRAWIO_LIMITS.cells) {
            warnings.add('limit_exceeded', `Only the first ${DRAWIO_LIMITS.cells} cells of a page were read`);
            break;
        }
        seen.add(id);
        cells.push({
            id,
            parent: attribute(element, 'parent'),
            value: (wrapper ? attribute(wrapper, 'label') : attribute(element, 'value')) ?? '',
            style: parseStyle(attribute(element, 'style')),
            vertex: attribute(element, 'vertex') === '1',
            edge: attribute(element, 'edge') === '1',
            source: attribute(element, 'source'),
            target: attribute(element, 'target'),
            geometry: readGeometry(element),
            data: wrapper ? wrapper.attributes : null
        });
    }
    return cells;
}

function cellText(cell) {
    let raw = cell.value;
    if (cell.data && cell.style.values.placeholders === '1') {
        raw = raw.replace(/%([A-Za-z0-9_]{1,64})%/g, (match, key) => (RESERVED_ATTRIBUTES.has(key) || cell.data[key] === undefined ? match : cell.data[key]));
    }
    const text = cell.style.values.html === '1' ? htmlToText(raw) : raw;
    return lines(text).join('\n');
}

function shapeOf(style) {
    const { names, shape } = style;
    if (names.has('text') || shape === 'text') return 'text';
    if (names.has('ellipse') || names.has('doubleEllipse') || shape === 'ellipse' || shape === 'doubleellipse') return 'circle';
    if (names.has('rhombus') || shape === 'rhombus') return 'diamond';
    if (shape.startsWith('cylinder') || shape === 'datastore') return 'cylinder';
    if (shape === 'umlactor' || names.has('umlActor')) return 'actor';
    if (shape === 'note' || names.has('note')) return 'note';
    return 'card';
}

function cellColor(style) {
    return chromaticColor(style.values.fillColor) ?? chromaticColor(style.values.strokeColor);
}

function isDecoration(style) {
    return style.names.has('line') || style.shape === 'line';
}

function analysePage(cells) {
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const children = new Map();
    for (const cell of cells) {
        if (!children.has(cell.parent)) children.set(cell.parent, []);
        children.get(cell.parent).push(cell);
    }
    const roots = new Set(cells.filter((cell) => !cell.parent || !byId.has(cell.parent) || cell.parent === cell.id).map((cell) => cell.id));
    const layers = new Set(cells.filter((cell) => !roots.has(cell.id) && roots.has(cell.parent) && !cell.vertex && !cell.edge).map((cell) => cell.id));
    const structural = (id) => roots.has(id) || layers.has(id);

    const ancestors = new Map();
    const chain = (cell) => {
        if (ancestors.has(cell.id)) return ancestors.get(cell.id);
        const result = [];
        const visited = new Set([cell.id]);
        let current = byId.get(cell.parent);
        while (current && !structural(current.id) && !visited.has(current.id) && result.length < 256) {
            result.push(current);
            visited.add(current.id);
            current = byId.get(current.parent);
        }
        ancestors.set(cell.id, result);
        return result;
    };

    const absolute = new Map();
    const position = (cell) => {
        if (absolute.has(cell.id)) return absolute.get(cell.id);
        let x = 0;
        let y = 0;
        for (const ancestor of chain(cell)) {
            if (ancestor.edge || !ancestor.geometry || ancestor.geometry.relative) continue;
            x += ancestor.geometry.x;
            y += ancestor.geometry.y;
        }
        const own = cell.geometry && !cell.geometry.relative && !cell.edge ? { x: x + cell.geometry.x, y: y + cell.geometry.y } : { x, y };
        const result = { origin: { x, y }, x: own.x, y: own.y, w: cell.geometry?.w ?? 0, h: cell.geometry?.h ?? 0 };
        absolute.set(cell.id, result);
        return result;
    };

    const edgeParent = (cell) => chain(cell).find((ancestor) => ancestor.edge);
    const isEdgeLabel = (cell) => cell.vertex && (cell.style.names.has('edgeLabel') || Boolean(edgeParent(cell)));
    const vertexChildren = (cell) => (children.get(cell.id) ?? []).filter((child) => child.vertex && !isEdgeLabel(child));

    return { byId, children, structural, chain, position, isEdgeLabel, vertexChildren };
}

function isContainer(cell, page) {
    const { names, values, shape } = cell.style;
    if (shape === 'umllifeline') return false;
    return names.has('swimlane') || names.has('group') || values.container === '1' || page.vertexChildren(cell).length > 0;
}

function edgeStyle(style) {
    const { values } = style;
    if (values.dashed === '1') return /^\s*1(\s|$)/.test(values.dashPattern ?? '') ? 'dotted' : 'dashed';
    if ((finiteNumber(values.strokeWidth) ?? 1) >= 3) return 'thick';
    return 'solid';
}

function edgeArrow(style) {
    const end = (style.values.endArrow ?? 'classic') !== 'none' && style.values.endArrow !== '';
    const start = (style.values.startArrow ?? 'none') !== 'none' && style.values.startArrow !== '';
    return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

function edgeLabel(edge, page) {
    const parts = [cellText(edge)];
    for (const child of page.children.get(edge.id) ?? []) {
        if (child.vertex) parts.push(cellText(child));
    }
    return singleLine(parts.filter(Boolean).join(' \u00b7 '));
}

function box(position) {
    return { x: position.x, y: position.y, w: Math.max(position.w, 0), h: Math.max(position.h, 0) };
}

function containsPoint(target, at, tolerance) {
    return at.x >= target.x - tolerance && at.x <= target.x + target.w + tolerance && at.y >= target.y - tolerance && at.y <= target.y + target.h + tolerance;
}

function distanceToBox(target, at) {
    const dx = Math.max(target.x - at.x, 0, at.x - (target.x + target.w));
    const dy = Math.max(target.y - at.y, 0, at.y - (target.y + target.h));
    return Math.hypot(dx, dy);
}

function nodeExtras(cell, record, warnings, pageLinks) {
    if (!cell.data) return;
    const link = cell.data.link;
    if (link) {
        const page = PAGE_LINK.exec(link);
        if (page) pageLinks.push({ record, page: page[1] });
        else {
            const href = safeHref(link);
            if (href) record.link = { href };
            else warnings.add('unsafe_link', 'A link with an unsupported scheme was removed');
        }
    }
    const tooltip = cell.data.tooltip ? lines(cell.data.tooltip).join('\n') : '';
    if (tooltip) record.description = clip([record.description, tooltip].filter(Boolean).join('\n\n'), LIMITS.longText);
    const tags = String(cell.data.tags ?? '').split(/\s+/).map((tag) => clip(tag, 40)).filter(Boolean).slice(0, LIMITS.tags);
    if (tags.length) record.tags = [...new Set(tags)];
    if (record.props !== undefined || record.kind === 'group') return;
    const props = [];
    for (const [key, value] of Object.entries(cell.data)) {
        if (RESERVED_ATTRIBUTES.has(key) || props.length >= LIMITS.props) continue;
        const text = clip(singleLine(value), 400);
        const label = clip(key, 60);
        if (text && label) props.push({ label, value: text });
    }
    if (props.length) record.props = props;
}

function headerDescription(candidates, others) {
    if (!candidates.length) return { description: undefined, rest: candidates };
    const sorted = [...candidates].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const top = sorted[0];
    const contentTop = others.reduce((min, entry) => Math.min(min, entry.box.y), Infinity);
    if (top.box.y + top.box.h > contentTop + 4) return { description: undefined, rest: candidates };
    return { description: top.text, rest: candidates.filter((entry) => entry !== top) };
}

function buildGraph(cells, page, context) {
    const { warnings, layout, lang, pageLinks } = context;
    const ids = createIdFactory('node');
    const mapped = new Map();
    const groups = [];
    const groupOf = new Map();
    const endpoints = new Set();
    for (const cell of cells) {
        if (!cell.edge) continue;
        if (cell.source) endpoints.add(cell.source);
        if (cell.target) endpoints.add(cell.target);
    }

    const vertices = cells.filter((cell) => cell.vertex && !page.structural(cell.id) && !page.isEdgeLabel(cell));
    const lifelineOwner = new Map();
    for (const cell of vertices) {
        const lifeline = page.chain(cell).find((ancestor) => ancestor.style.shape === 'umllifeline');
        if (lifeline) lifelineOwner.set(cell.id, lifeline.id);
    }

    let untitled = 0;
    const containers = vertices
        .filter((cell) => !lifelineOwner.has(cell.id) && isContainer(cell, page))
        .sort((a, b) => page.chain(a).length - page.chain(b).length);
    for (const cell of containers) {
        const text = cellText(cell);
        const invisible = cell.style.names.has('group') && !text;
        const depth = page.chain(cell).filter((ancestor) => groupOf.has(ancestor.id)).length;
        if (invisible || depth >= LIMITS.depth || groups.length >= LIMITS.groups) {
            if (!invisible) warnings.add('flattened_groups', 'Some containers were merged into their parent');
            continue;
        }
        const label = splitLabel(text);
        if (!label.title) {
            untitled += 1;
            warnings.add('untitled_group', 'A container without a title received a generic one');
        }
        const parent = page.chain(cell).find((ancestor) => groupOf.has(ancestor.id));
        const group = {
            id: ids.id(cell.id),
            title: label.title ?? `${fallbackText(lang, 'group')} ${untitled}`,
            kind: 'group',
            parent: parent ? groupOf.get(parent.id).id : undefined,
            color: cellColor(cell.style) ?? 'neutral'
        };
        if (label.subtitle || label.description) group.description = clip([label.subtitle, label.description].filter(Boolean).join('\n'), LIMITS.longText);
        const position = box(page.position(cell));
        Object.assign(group, { x: position.x, y: position.y, w: position.w, h: position.h });
        nodeExtras(cell, group, warnings, pageLinks);
        groups.push(group);
        groupOf.set(cell.id, group);
        mapped.set(cell.id, group.id);
    }

    const entries = [];
    let skipped = 0;
    for (const cell of vertices) {
        if (groupOf.has(cell.id) || lifelineOwner.has(cell.id)) continue;
        if (isContainer(cell, page) && cell.style.names.has('group') && !cellText(cell)) continue;
        if (isDecoration(cell.style)) {
            skipped += 1;
            continue;
        }
        const text = cellText(cell);
        const connected = endpoints.has(cell.id);
        if (!text && !connected) {
            skipped += 1;
            continue;
        }
        const parent = page.chain(cell).find((ancestor) => groupOf.has(ancestor.id));
        const shape = shapeOf(cell.style);
        const position = box(page.position(cell));
        entries.push({ cell, text, shape, group: parent ? groupOf.get(parent.id).id : undefined, box: position, loose: shape === 'text' && !parent && !connected });
    }
    if (skipped) warnings.add('skipped_shapes', 'Decorative shapes without text were not imported');

    const looseText = entries.filter((entry) => entry.loose && entry.text);
    const others = entries.filter((entry) => !entry.loose);
    const header = headerDescription(looseText, others);
    const headerEntry = looseText.find((entry) => !header.rest.includes(entry));

    const nodes = [];
    let fallbackIndex = 0;
    for (const entry of entries) {
        if (entry === headerEntry) continue;
        if (nodes.length >= LIMITS.nodes) {
            warnings.add('limit_exceeded', `Only the first ${LIMITS.nodes} nodes were kept`);
            break;
        }
        const label = splitLabel(entry.text);
        if (!label.title) {
            fallbackIndex += 1;
            warnings.add('untitled_node', 'A connected shape without text received a generic title');
        }
        const node = { id: ids.id(entry.cell.id), title: label.title ?? `${fallbackText(lang, 'node')} ${fallbackIndex}`, shape: entry.shape };
        if (label.subtitle) node.subtitle = label.subtitle;
        if (label.description) node.description = label.description;
        const color = cellColor(entry.cell.style);
        if (color && entry.shape !== 'text') node.color = color;
        if (entry.group) node.group = entry.group;
        Object.assign(node, { x: entry.box.x, y: entry.box.y, w: entry.box.w, h: entry.box.h });
        nodeExtras(entry.cell, node, warnings, pageLinks);
        nodes.push(node);
        mapped.set(entry.cell.id, node.id);
    }
    for (const [cellId, ownerId] of lifelineOwner) {
        if (mapped.has(ownerId)) mapped.set(cellId, mapped.get(ownerId));
    }

    const nodeBoxes = nodes.map((node) => ({ id: node.id, box: { x: node.x, y: node.y, w: node.w, h: node.h } }));
    const snap = (at) => {
        let best = null;
        let bestScore = Infinity;
        for (const entry of nodeBoxes) {
            if (containsPoint(entry.box, at, 12)) {
                const area = entry.box.w * entry.box.h;
                if (area < bestScore) {
                    best = entry.id;
                    bestScore = area;
                }
            }
        }
        if (best) return best;
        bestScore = 24;
        for (const entry of nodeBoxes) {
            const distance = distanceToBox(entry.box, at);
            if (distance <= bestScore) {
                best = entry.id;
                bestScore = distance;
            }
        }
        return best;
    };
    const resolve = (cellId, at) => {
        if (cellId !== undefined) {
            const cell = page.byId.get(cellId);
            if (cell) {
                if (mapped.has(cell.id)) return mapped.get(cell.id);
                const ancestor = page.chain(cell).find((candidate) => mapped.has(candidate.id));
                if (ancestor) return mapped.get(ancestor.id);
            }
        }
        return at ? snap(at) : null;
    };

    const edges = [];
    let dropped = 0;
    let horizontal = 0;
    let vertical = 0;
    const centers = new Map(nodes.map((node) => [node.id, { x: node.x + node.w / 2, y: node.y + node.h / 2 }]));
    for (const cell of cells) {
        if (!cell.edge) continue;
        if (edges.length >= LIMITS.edges) {
            warnings.add('limit_exceeded', `Only the first ${LIMITS.edges} edges were kept`);
            break;
        }
        const origin = page.position(cell).origin;
        const shift = (at) => (at ? { x: at.x + origin.x, y: at.y + origin.y } : undefined);
        const from = resolve(cell.source, shift(cell.geometry?.sourcePoint));
        const to = resolve(cell.target, shift(cell.geometry?.targetPoint));
        if (!from || !to) {
            dropped += 1;
            continue;
        }
        const edge = { from, to, style: edgeStyle(cell.style), arrow: edgeArrow(cell.style) };
        const label = edgeLabel(cell, page);
        if (label) {
            edge.label = clip(label, 80);
            if (label.length > 80) edge.description = clip(label, LIMITS.longText);
        }
        const color = chromaticColor(cell.style.values.strokeColor);
        if (color) edge.color = color;
        if (cell.geometry?.points.length) edge.points = cell.geometry.points.map(shift);
        edges.push(edge);
        const a = centers.get(from);
        const b = centers.get(to);
        if (a && b && from !== to) {
            if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) horizontal += 1;
            else vertical += 1;
        }
    }
    if (dropped) warnings.add('dangling_edge', 'Connectors without both ends were not imported');

    const coordinates = (target, max) => {
        if (layout === 'auto') {
            delete target.x;
            delete target.y;
            delete target.w;
            delete target.h;
            return;
        }
        target.x = clampNumber(target.x, -1e6, 1e6);
        target.y = clampNumber(target.y, -1e6, 1e6);
        target.w = clampNumber(target.w, 8, max);
        target.h = clampNumber(target.h, 8, max);
    };
    nodes.forEach((node) => coordinates(node, 4000));
    groups.forEach((group) => {
        coordinates(group, 20000);
        delete group.kind;
    });
    edges.forEach((edge) => {
        if (layout === 'auto') delete edge.points;
        else if (edge.points) edge.points = edge.points.map((at) => ({ x: clampNumber(at.x, -1e6, 1e6), y: clampNumber(at.y, -1e6, 1e6) }));
    });

    return {
        content: { kind: 'graph', direction: vertical > horizontal ? 'TB' : 'LR', groups, nodes, edges },
        description: header.description
    };
}

function participantKind(style) {
    const participant = String(style.values.participant ?? '').toLowerCase();
    if (participant === 'umlactor') return 'actor';
    if (participant === 'umlentity') return 'store';
    return 'system';
}

function messageStyle(style) {
    if (style.values.dashed === '1') return 'reply';
    if (style.values.endArrow === 'open' || style.values.endFill === '0') return 'async';
    return 'sync';
}

function buildSequence(cells, page, context) {
    const { warnings, pageLinks } = context;
    const ids = createIdFactory('participant');
    const lifelines = cells
        .filter((cell) => cell.vertex && cell.style.shape === 'umllifeline' && !page.structural(cell.id))
        .map((cell) => ({ cell, box: box(page.position(cell)) }))
        .sort((a, b) => a.box.x - b.box.x)
        .slice(0, 60);
    const participants = [];
    const owner = new Map();
    lifelines.forEach((entry, index) => {
        const label = splitLabel(cellText(entry.cell), { title: 80, subtitle: 120 });
        const participant = { id: ids.id(entry.cell.id), title: label.title ?? `${fallbackText(context.lang, 'node')} ${index + 1}`, kind: participantKind(entry.cell.style) };
        if (label.subtitle) participant.subtitle = label.subtitle;
        if (label.description) participant.description = label.description;
        nodeExtras(entry.cell, participant, warnings, pageLinks);
        delete participant.props;
        delete participant.tags;
        participants.push(participant);
        entry.id = participant.id;
        owner.set(entry.cell.id, participant.id);
    });
    const lifelineAt = (x) => {
        let best = null;
        let bestDistance = Infinity;
        for (const entry of lifelines) {
            if (x < entry.box.x - 12 || x > entry.box.x + entry.box.w + 12) continue;
            const distance = Math.abs(entry.box.x + entry.box.w / 2 - x);
            if (distance < bestDistance) {
                best = entry.id;
                bestDistance = distance;
            }
        }
        return best;
    };
    const ownerOf = (cell) => owner.get(cell.id) ?? page.chain(cell).map((ancestor) => owner.get(ancestor.id)).find(Boolean);

    const timeline = [];
    const orderOf = new Map(cells.map((cell, index) => [cell.id, index]));
    let dropped = 0;
    cells.forEach((cell, order) => {
        if (!cell.edge) return;
        const origin = page.position(cell).origin;
        const shift = (at) => (at ? { x: at.x + origin.x, y: at.y + origin.y } : undefined);
        const sourcePoint = shift(cell.geometry?.sourcePoint);
        const targetPoint = shift(cell.geometry?.targetPoint);
        const sourceCell = cell.source ? page.byId.get(cell.source) : undefined;
        const targetCell = cell.target ? page.byId.get(cell.target) : undefined;
        const from = (sourceCell && ownerOf(sourceCell)) || (sourcePoint && lifelineAt(sourcePoint.x));
        const to = (targetCell && ownerOf(targetCell)) || (targetPoint && lifelineAt(targetPoint.x));
        const label = edgeLabel(cell, page);
        const sameSpot = sourcePoint && targetPoint && sourcePoint.x === targetPoint.x && sourcePoint.y === targetPoint.y;
        if (!from || !to || (sameSpot && !label)) {
            dropped += 1;
            return;
        }
        const anchor = sourcePoint ?? shift(cell.geometry?.points[0]) ?? targetPoint ?? (sourceCell ? page.position(sourceCell) : { y: 0 });
        const item = { type: 'message', from, to, style: messageStyle(cell.style) };
        if (label) {
            item.label = clip(label, 160);
            if (label.length > 160) item.description = clip(label, LIMITS.longText);
        }
        timeline.push({ y: anchor.y, order, item });
    });
    if (dropped) warnings.add('dangling_edge', 'Connectors that do not join two lifelines were not imported');

    const free = cells.filter((cell) => cell.vertex && !page.structural(cell.id) && !page.isEdgeLabel(cell) && !owner.has(cell.id) && !ownerOf(cell) && !isDecoration(cell.style));
    const texts = free.map((cell) => ({ cell, text: cellText(cell), box: box(page.position(cell)) })).filter((entry) => entry.text);
    const loose = texts.filter((entry) => shapeOf(entry.cell.style) === 'text');
    const header = headerDescription(loose, lifelines);
    const headerEntry = loose.find((entry) => !header.rest.includes(entry));
    let skipped = free.length - texts.length;
    texts.forEach((entry) => {
        if (entry === headerEntry) return;
        const over = lifelines.filter((lifeline) => lifeline.box.x < entry.box.x + entry.box.w && lifeline.box.x + lifeline.box.w > entry.box.x);
        if (!over.length) {
            skipped += 1;
            return;
        }
        const refs = [...new Set([over[0].id, over[over.length - 1].id])];
        timeline.push({ y: entry.box.y, order: orderOf.get(entry.cell.id), item: { type: 'note', over: refs, text: clip(entry.text, 400) } });
    });
    if (skipped) warnings.add('skipped_shapes', 'Shapes outside the lifelines were not imported');

    timeline.sort((a, b) => a.y - b.y || a.order - b.order);
    if (timeline.length > LIMITS.items) warnings.add('limit_exceeded', `Only the first ${LIMITS.items} sequence items were kept`);
    return {
        content: { kind: 'sequence', participants, items: timeline.slice(0, LIMITS.items).map((entry) => entry.item) },
        description: header.description
    };
}

function isSequencePage(cells, page) {
    const lifelines = cells.filter((cell) => cell.vertex && cell.style.shape === 'umllifeline');
    if (lifelines.length < 2 || lifelines.length > 60) return false;
    const edges = cells.filter((cell) => cell.edge);
    if (!edges.length) return false;
    const boxes = lifelines.map((cell) => box(page.position(cell)));
    const lifelineIds = new Set(lifelines.map((cell) => cell.id));
    const touches = (cellId, at) => {
        if (cellId) {
            const cell = page.byId.get(cellId);
            if (cell && (lifelineIds.has(cell.id) || page.chain(cell).some((ancestor) => lifelineIds.has(ancestor.id)))) return true;
        }
        return Boolean(at) && boxes.some((target) => at.x >= target.x - 12 && at.x <= target.x + target.w + 12);
    };
    const joined = edges.filter((edge) => {
        const origin = page.position(edge).origin;
        const shift = (at) => (at ? { x: at.x + origin.x, y: at.y + origin.y } : undefined);
        return touches(edge.source, shift(edge.geometry?.sourcePoint)) && touches(edge.target, shift(edge.geometry?.targetPoint));
    });
    return joined.length * 2 >= edges.length;
}

async function readPages(document) {
    const root = rootElement(document);
    if (!root) throw new ImportError('parse_error', 'Empty XML document');
    if (root.name === 'mxGraphModel') return [{ name: undefined, id: undefined, model: root }];
    if (root.name !== 'mxfile') throw new ImportError('unsupported_format', 'Not a draw.io document');
    const pages = [];
    for (const diagram of childElements(root, 'diagram')) {
        let model = firstChild(diagram, 'mxGraphModel');
        if (!model) {
            const packed = textContent(diagram).trim();
            if (packed) {
                const inner = rootElement(parseDocument(await inflatePage(packed)));
                if (inner?.name === 'mxGraphModel') model = inner;
            }
        }
        pages.push({ name: attribute(diagram, 'name'), id: attribute(diagram, 'id'), model });
        if (pages.length > LIMITS.diagrams) break;
    }
    return pages;
}

export function isDrawioText(text) {
    return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]{0,2000}?-->\s*)?<(mxfile|mxGraphModel)\b/.test(String(text ?? '').slice(0, 4096));
}

export async function parseDrawio(text, options = {}) {
    const warnings = new Warnings();
    const layout = options.layout === 'auto' ? 'auto' : 'keep';
    const lang = options.lang ?? 'es';
    const pages = await readPages(parseDocument(text));
    if (pages.length > LIMITS.diagrams) warnings.add('limit_exceeded', `Only the first ${LIMITS.diagrams} pages were kept`);
    const pageIds = createIdFactory('diagram', { lower: true });
    const kept = pages.slice(0, LIMITS.diagrams).map((entry, index) => ({ ...entry, diagramId: pageIds.id(entry.id ?? entry.name ?? `page-${index + 1}`) }));
    const byPageId = new Map(kept.filter((entry) => entry.id !== undefined).map((entry) => [entry.id, entry.diagramId]));

    const diagrams = [];
    const pageLinks = [];
    for (const [index, entry] of kept.entries()) {
        if (!entry.model) {
            warnings.add('empty_page', 'A page without content was skipped');
            continue;
        }
        const cells = readCells(entry.model, warnings);
        const page = analysePage(cells);
        const context = { warnings, layout, lang, pageLinks: [] };
        const built = isSequencePage(cells, page) ? buildSequence(cells, page, context) : buildGraph(cells, page, context);
        const empty = built.content.kind === 'graph' ? !built.content.nodes.length : !built.content.participants.length;
        if (empty) {
            warnings.add('empty_page', 'A page without content was skipped');
            continue;
        }
        const title = clip(singleLine(entry.name ?? ''), 120) ?? `${fallbackText(lang, 'diagram')} ${index + 1}`;
        const diagram = { id: entry.diagramId, title, ...built.content };
        const description = clip(built.description, LIMITS.longText);
        if (description) diagram.description = description;
        diagrams.push(diagram);
        pageLinks.push(...context.pageLinks);
    }
    if (!diagrams.length) throw new ImportError('empty', 'The draw.io file has no importable pages');

    const present = new Set(diagrams.map((diagram) => diagram.id));
    for (const { record, page } of pageLinks) {
        const target = byPageId.get(page);
        if (target && present.has(target)) record.link = { diagram: target };
        else warnings.add('broken_link', 'A link to a missing page was removed');
    }

    const set = {
        version: 1,
        title: clip(options.title, 120) ?? diagrams[0].title,
        lang,
        diagrams
    };
    return { set, warnings: warnings.list };
}
