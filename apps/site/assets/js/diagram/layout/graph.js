import { METRICS, approximateMeasure, edgeLabelSize, groupChipSize, nodeSize } from '../metrics.js';
import { layered } from './layered.js';
import { placeLabels, routeEdges } from './route.js';

const ROOT = '\u0000root';
const CHIP_INSET = 14;
const BADGE_OVERHANG = 9;

function laneHeaderWidth(lane, measure) {
    const m = METRICS.lane;
    const icons = lane.icons.length ? lane.icons.length * (m.icon + 6) + 4 : 0;
    return Math.ceil(m.pad * 2 + icons + measure(lane.title, m.title));
}

export function defaultExpanded(diagram) {
    return new Set(diagram.nodes.filter((node) => node.expanded).map((node) => node.id));
}

export function defaultCollapsed(diagram) {
    return new Set(diagram.groups.filter((group) => group.collapsed).map((group) => group.id));
}

function buildStructure(diagram, collapsed) {
    const groups = new Map(diagram.groups.map((group) => [group.id, group]));
    const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
    const parentOf = (id) => (nodes.has(id) ? nodes.get(id).group : groups.get(id)?.parent) ?? null;
    const ancestors = (id) => {
        const chain = [];
        let current = parentOf(id);
        while (current && chain.length < 64) {
            chain.push(current);
            current = groups.get(current)?.parent ?? null;
        }
        return chain;
    };
    const representative = (id) => {
        let rep = id;
        for (const ancestor of ancestors(id)) if (collapsed.has(ancestor)) rep = ancestor;
        return rep;
    };
    const visibleNodes = diagram.nodes.filter((node) => representative(node.id) === node.id);
    const visibleGroups = diagram.groups.filter((group) => representative(group.id) === group.id);
    const depth = (id) => ancestors(id).length;
    return { groups, nodes, parentOf, ancestors, representative, visibleNodes, visibleGroups, depth };
}

function visibleEdges(diagram, structure) {
    const result = [];
    const seen = new Map();
    for (const edge of diagram.edges) {
        const from = structure.representative(edge.from);
        const to = structure.representative(edge.to);
        const redirected = from !== edge.from || to !== edge.to;
        if (from === to && edge.from !== edge.to) continue;
        if (from !== to && (structure.ancestors(to).includes(from) || structure.ancestors(from).includes(to))) continue;
        const key = `${from}>${to}`;
        if (redirected && seen.has(key)) {
            seen.get(key).merged.push(edge.id);
            continue;
        }
        const entry = { edge, id: edge.id, from, to, redirected, merged: [], points: redirected ? [] : edge.points };
        result.push(entry);
        if (!seen.has(key)) seen.set(key, entry);
    }
    return result;
}

function nodeVisual(node, box) {
    const top = node.badge && (node.shape === 'card' || node.shape === 'cylinder') ? BADGE_OVERHANG : 0;
    return { x: box.x, y: box.y - top, w: box.w, h: box.h + top };
}

function shapeExtras(node, box) {
    if (node.shape === 'tile') {
        const size = METRICS.tile.size;
        return { square: { x: box.x + (box.w - size) / 2, y: box.y, w: size, h: size } };
    }
    if (node.shape === 'actor') {
        const m = METRICS.actor;
        return { figure: { x: box.x + (box.w - m.figureWidth) / 2, y: box.y, w: m.figureWidth, h: m.figureHeight } };
    }
    return {};
}

function laneIndexFor(diagram, structure) {
    if (!diagram.lanes.length) return null;
    const laneIndex = new Map(diagram.lanes.map((lane, index) => [lane.id, index]));
    const assigned = new Map();
    for (const node of diagram.nodes) if (node.lane && laneIndex.has(node.lane)) assigned.set(node.id, laneIndex.get(node.lane));
    for (let pass = 0; pass < 3; pass += 1) {
        for (const edge of diagram.edges) {
            if (!assigned.has(edge.from) && assigned.has(edge.to)) assigned.set(edge.from, assigned.get(edge.to));
            if (!assigned.has(edge.to) && assigned.has(edge.from)) assigned.set(edge.to, assigned.get(edge.from));
        }
    }
    const laneOfNode = (id) => assigned.get(id) ?? 0;
    const topLevel = (id) => {
        const chain = structure.ancestors(id);
        return chain.length ? chain[chain.length - 1] : id;
    };
    const result = new Map();
    for (const node of diagram.nodes) {
        const top = topLevel(node.id);
        if (!result.has(top)) result.set(top, laneOfNode(node.id));
    }
    for (const group of diagram.groups) {
        const top = topLevel(group.id);
        if (!result.has(top)) result.set(top, 0);
    }
    return result;
}

function liftEdges(edges, structure, containerOf) {
    const byContainer = new Map();
    for (const entry of edges) {
        if (entry.from === entry.to) continue;
        const chainF = [entry.from, ...structure.ancestors(entry.from), ROOT];
        const chainT = [entry.to, ...structure.ancestors(entry.to), ROOT];
        const containersT = new Set(chainT.slice(1));
        let level = -1;
        for (let index = 1; index < chainF.length; index += 1) {
            if (containersT.has(chainF[index])) {
                level = index;
                break;
            }
        }
        if (level < 0) continue;
        const container = chainF[level];
        const a = chainF[level - 1];
        const b = chainT[chainT.indexOf(container) - 1];
        if (!a || !b || a === b) continue;
        if (containerOf(a) !== container || containerOf(b) !== container) continue;
        if (!byContainer.has(container)) byContainer.set(container, []);
        byContainer.get(container).push({ id: entry.id, from: a, to: b, label: entry.labelSize ?? null });
    }
    return byContainer;
}

function autoLayout(diagram, context) {
    const { structure, sizes, edges, measure, collapsed } = context;
    const spacing = METRICS.spacing[diagram.density] ?? METRICS.spacing.compact;
    const gm = METRICS.group;
    const chipH = gm.chip.height;
    const children = new Map([[ROOT, []]]);
    const order = new Map();
    diagram.nodes.forEach((node, index) => order.set(node.id, index));
    for (const group of diagram.groups) {
        const firstNode = diagram.nodes.findIndex((node) => structure.ancestors(node.id).includes(group.id));
        order.set(group.id, firstNode >= 0 ? firstNode - 0.5 : diagram.nodes.length + diagram.groups.indexOf(group));
    }
    const containerOf = (id) => structure.parentOf(id) ?? ROOT;
    const visibleIds = [...structure.visibleGroups.map((group) => group.id), ...structure.visibleNodes.map((node) => node.id)];
    for (const id of visibleIds) {
        if (structure.groups.has(id) && !collapsed.has(id)) children.set(id, []);
    }
    for (const id of visibleIds) {
        const parent = containerOf(id);
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(id);
    }
    for (const list of children.values()) list.sort((a, b) => order.get(a) - order.get(b));

    const lifted = liftEdges(edges, structure, containerOf);
    const laneOf = laneIndexFor(diagram, structure);
    const blocks = new Map();
    const footprint = (id) => {
        if (sizes.has(id)) {
            const size = sizes.get(id);
            const node = structure.nodes.get(id);
            const top = node.badge && (node.shape === 'card' || node.shape === 'cylinder') ? BADGE_OVERHANG : 0;
            return { w: size.w, h: size.h + top, offsetY: top };
        }
        return blocks.get(id).footprint;
    };

    const layoutContainer = (containerId) => {
        const items = children.get(containerId) ?? [];
        for (const id of items) {
            if (structure.groups.has(id)) {
                const group = structure.groups.get(id);
                const chip = groupChipSize(group, measure);
                if (collapsed.has(id)) {
                    blocks.set(id, { footprint: { w: chip.w, h: chip.h, offsetY: 0 }, chip, collapsed: true });
                } else {
                    const inner = layoutContainer(id);
                    const innerW = Math.max(inner.width, 0);
                    const innerH = Math.max(inner.height, 0);
                    const boxW = Math.max(innerW + gm.pad * 2, chip.w + CHIP_INSET * 2);
                    const topPad = chipH / 2 + gm.pad * 0.75;
                    const boxH = topPad + innerH + gm.pad;
                    blocks.set(id, {
                        footprint: { w: boxW, h: boxH + chipH / 2, offsetY: chipH / 2 },
                        chip,
                        inner,
                        contentOffset: { x: (boxW - innerW) / 2, y: topPad }
                    });
                }
            }
        }
        const isRoot = containerId === ROOT;
        const useLanes = isRoot && laneOf;
        const layoutItems = items.map((id) => {
            const size = footprint(id);
            return { id, w: size.w, h: size.h, lane: useLanes ? laneOf.get(id) ?? 0 : 0 };
        });
        const lanes = useLanes ? {
            count: diagram.lanes.length,
            pad: METRICS.lane.pad,
            gap: METRICS.lane.gap,
            minWidths: diagram.lanes.map((lane) => laneHeaderWidth(lane, measure))
        } : null;
        const result = layered({
            items: layoutItems,
            edges: lifted.get(containerId) ?? [],
            direction: diagram.direction,
            spacing: isRoot ? spacing : { ...spacing, rank: Math.max(spacing.rank * 0.85, 48) },
            lanes
        });
        return result;
    };

    const root = layoutContainer(ROOT);
    const boxes = new Map();
    const groupBoxes = new Map();
    const hasLanes = Boolean(laneOf);
    const laneTop = hasLanes ? METRICS.lane.header + METRICS.lane.pad : 0;
    const place = (containerId, layout, originX, originY) => {
        for (const id of children.get(containerId) ?? []) {
            const position = layout.positions.get(id);
            const x = originX + position.x;
            const y = originY + position.y;
            if (sizes.has(id)) {
                const size = sizes.get(id);
                boxes.set(id, { x, y: y + footprint(id).offsetY, w: size.w, h: size.h });
                continue;
            }
            const block = blocks.get(id);
            if (block.collapsed) {
                const box = { x, y, w: block.chip.w, h: block.chip.h };
                groupBoxes.set(id, { box, header: box, collapsed: true });
                continue;
            }
            const box = { x, y: y + chipH / 2, w: block.footprint.w, h: block.footprint.h - chipH / 2 };
            const header = { x: box.x + CHIP_INSET, y: box.y - chipH / 2, w: block.chip.w, h: chipH };
            groupBoxes.set(id, { box, header, collapsed: false });
            place(id, block.inner, box.x + block.contentOffset.x, box.y + block.contentOffset.y);
        }
    };
    place(ROOT, root, 0, laneTop);
    for (const box of boxes.values()) {
        box.x = Math.round(box.x);
        box.y = Math.round(box.y);
    }
    for (const entry of groupBoxes.values()) {
        const dx = Math.round(entry.box.x) - entry.box.x;
        const dy = Math.round(entry.box.y) - entry.box.y;
        entry.box.x += dx;
        entry.box.y += dy;
        if (entry.header !== entry.box) {
            entry.header.x = Math.round(entry.header.x + dx);
            entry.header.y = Math.round(entry.header.y + dy);
        }
    }

    let lanes = [];
    if (hasLanes) {
        const contentBottom = Math.max(laneTop, ...[...boxes.values()].map((box) => box.y + box.h), ...[...groupBoxes.values()].map((entry) => entry.box.y + entry.box.h));
        const height = contentBottom + METRICS.lane.pad;
        lanes = diagram.lanes.map((lane, index) => {
            const band = root.laneBands[index] ?? { start: 0, end: laneHeaderWidth(lane, measure) };
            return {
                id: lane.id,
                title: lane.title,
                description: lane.description,
                icons: lane.icons,
                color: lane.color,
                x: band.start,
                y: 0,
                w: band.end - band.start,
                h: height,
                header: { x: band.start, y: 0, w: band.end - band.start, h: METRICS.lane.header },
                source: lane
            };
        });
    }
    return { boxes, groupBoxes, lanes };
}

function manualLayout(diagram, context) {
    const { structure, sizes, collapsed, measure } = context;
    const gm = METRICS.group;
    const chipH = gm.chip.height;
    const boxes = new Map();
    for (const node of structure.visibleNodes) {
        const size = sizes.get(node.id);
        boxes.set(node.id, { x: node.x, y: node.y, w: size.w, h: size.h });
    }
    const groupBoxes = new Map();
    const allNodeBoxes = new Map(diagram.nodes.map((node) => {
        const size = sizes.get(node.id) ?? nodeSize(node, { measure });
        return [node.id, { x: node.x, y: node.y, w: size.w, h: size.h }];
    }));
    const sorted = [...diagram.groups].sort((a, b) => structure.depth(b.id) - structure.depth(a.id));
    const bounds = new Map();
    for (const group of sorted) {
        const members = [];
        for (const node of diagram.nodes) if (node.group === group.id) members.push(allNodeBoxes.get(node.id));
        for (const child of diagram.groups) if (child.parent === group.id && bounds.has(child.id)) members.push(bounds.get(child.id));
        let box;
        if (group.x !== undefined && group.y !== undefined && group.w !== undefined && group.h !== undefined) {
            box = { x: group.x, y: group.y, w: group.w, h: group.h };
        } else if (members.length) {
            const minX = Math.min(...members.map((m) => m.x));
            const minY = Math.min(...members.map((m) => m.y));
            const maxX = Math.max(...members.map((m) => m.x + m.w));
            const maxY = Math.max(...members.map((m) => m.y + m.h));
            box = { x: minX - gm.pad, y: minY - gm.pad - chipH / 2, w: maxX - minX + gm.pad * 2, h: maxY - minY + gm.pad * 2 + chipH / 2 };
        } else {
            box = { x: group.x ?? 0, y: group.y ?? 0, w: group.w ?? 160, h: group.h ?? 80 };
        }
        bounds.set(group.id, { ...box, y: box.y - chipH / 2, h: box.h + chipH / 2 });
        const chip = groupChipSize(group, measure);
        if (structure.representative(group.id) !== group.id) continue;
        if (collapsed.has(group.id)) {
            const chipBox = { x: box.x, y: box.y, w: chip.w, h: chip.h };
            groupBoxes.set(group.id, { box: chipBox, header: chipBox, collapsed: true });
        } else {
            groupBoxes.set(group.id, { box, header: { x: box.x + CHIP_INSET, y: box.y - chipH / 2, w: chip.w, h: chipH }, collapsed: false });
        }
    }
    let lanes = [];
    if (diagram.lanes.length) {
        const m = METRICS.lane;
        const all = [...boxes.values(), ...[...groupBoxes.values()].map((entry) => entry.box)];
        const top = Math.min(...all.map((box) => box.y)) - m.pad - m.header;
        const bottom = Math.max(...all.map((box) => box.y + box.h)) + m.pad;
        let cursor = Math.min(...all.map((box) => box.x)) - m.pad;
        lanes = diagram.lanes.map((lane) => {
            const members = diagram.nodes.filter((node) => node.lane === lane.id && boxes.has(node.id)).map((node) => boxes.get(node.id));
            const start = members.length ? Math.max(cursor, Math.min(...members.map((box) => box.x)) - m.pad) : cursor;
            const end = Math.max(start + laneHeaderWidth(lane, measure), members.length ? Math.max(...members.map((box) => box.x + box.w)) + m.pad : start);
            cursor = end + m.gap;
            return {
                id: lane.id, title: lane.title, description: lane.description, icons: lane.icons, color: lane.color,
                x: start, y: top, w: end - start, h: bottom - top,
                header: { x: start, y: top, w: end - start, h: m.header },
                source: lane
            };
        });
    }
    return { boxes, groupBoxes, lanes };
}

function translate(scene, dx, dy) {
    const move = (box) => {
        if (!box) return;
        box.x += dx;
        box.y += dy;
    };
    for (const lane of scene.lanes) { move(lane); move(lane.header); }
    for (const group of scene.groups) { move(group); if (group.header !== group) move(group.header); }
    for (const node of scene.nodes) move(node);
    for (const edge of scene.edges) {
        for (const point of edge.points) move(point);
        move(edge.labelBox);
    }
}

export function layoutGraph(diagram, { measure = approximateMeasure, expanded, collapsed } = {}) {
    const expandedSet = expanded ?? defaultExpanded(diagram);
    const collapsedSet = collapsed ?? defaultCollapsed(diagram);
    const structure = buildStructure(diagram, collapsedSet);
    const sizes = new Map();
    for (const node of structure.visibleNodes) sizes.set(node.id, nodeSize(node, { measure, expanded: expandedSet.has(node.id) }));
    const edges = visibleEdges(diagram, structure).map((entry) => ({
        ...entry,
        labelSize: entry.edge.label ? edgeLabelSize(entry.edge.label, measure) : null
    }));
    const manual = diagram.nodes.length > 0 && diagram.nodes.every((node) => node.x !== undefined && node.y !== undefined);
    const context = { structure, sizes, edges, measure, collapsed: collapsedSet };
    const { boxes, groupBoxes, lanes } = manual ? manualLayout(diagram, context) : autoLayout(diagram, context);

    const endpoints = new Map();
    const obstacles = [];
    for (const node of structure.visibleNodes) {
        const box = boxes.get(node.id);
        const clearance = nodeVisual(node, box);
        endpoints.set(node.id, { id: node.id, box, clearance, shape: node.shape, ancestors: structure.ancestors(node.id), ...shapeExtras(node, box) });
        obstacles.push(clearance);
    }
    const chips = [];
    const routedGroups = [];
    for (const [id, entry] of groupBoxes) {
        endpoints.set(id, { id, box: entry.box, clearance: entry.box, shape: 'group', ancestors: [id, ...structure.ancestors(id)] });
        if (entry.collapsed) obstacles.push(entry.box);
        else {
            chips.push(entry.header);
            obstacles.push(entry.header);
            routedGroups.push({ id, box: entry.box });
        }
    }
    const routes = routeEdges({ edges, endpoints, obstacles, groups: routedGroups, direction: diagram.direction, manual });
    const labelBoxes = placeLabels(edges, routes, obstacles, chips, diagram.direction);

    const scene = {
        kind: 'graph',
        width: 0,
        height: 0,
        direction: diagram.direction,
        manual,
        lanes,
        groups: [...groupBoxes.entries()]
            .map(([id, entry]) => {
                const group = structure.groups.get(id);
                return {
                    id,
                    title: group.title,
                    icon: group.icon,
                    color: group.color,
                    depth: structure.depth(id),
                    collapsed: entry.collapsed,
                    x: entry.box.x,
                    y: entry.box.y,
                    w: entry.box.w,
                    h: entry.box.h,
                    header: { ...entry.header },
                    source: group
                };
            })
            .sort((a, b) => a.depth - b.depth || diagram.groups.indexOf(a.source) - diagram.groups.indexOf(b.source)),
        nodes: structure.visibleNodes.map((node) => {
            const box = boxes.get(node.id);
            return {
                id: node.id,
                shape: node.shape,
                expanded: expandedSet.has(node.id),
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
                text: sizes.get(node.id).text,
                group: node.group && structure.groups.has(node.group) ? node.group : undefined,
                source: node
            };
        }),
        edges: edges.filter((entry) => routes.has(entry.id)).map((entry) => ({
            id: entry.id,
            from: entry.from,
            to: entry.to,
            points: routes.get(entry.id).points.map((point) => ({ x: point.x, y: point.y })),
            label: entry.edge.label,
            labelBox: labelBoxes.get(entry.id),
            style: entry.edge.style,
            arrow: entry.edge.arrow,
            color: entry.edge.color,
            merged: entry.merged,
            source: entry.edge
        }))
    };

    const extents = [];
    const add = (box) => { if (box) extents.push(box); };
    scene.lanes.forEach(add);
    scene.groups.forEach((group) => { add(group); add(group.header); });
    scene.nodes.forEach((node) => add(nodeVisual(node.source, node)));
    for (const edge of scene.edges) {
        for (const point of edge.points) add({ x: point.x - 6, y: point.y - 6, w: 12, h: 12 });
        add(edge.labelBox);
    }
    const padding = METRICS.padding;
    if (extents.length) {
        const minX = Math.min(...extents.map((box) => box.x));
        const minY = Math.min(...extents.map((box) => box.y));
        const maxX = Math.max(...extents.map((box) => box.x + box.w));
        const maxY = Math.max(...extents.map((box) => box.y + box.h));
        translate(scene, padding - minX, padding - minY);
        scene.width = Math.ceil(maxX - minX + padding * 2);
        scene.height = Math.ceil(maxY - minY + padding * 2);
    } else {
        scene.width = padding * 2;
        scene.height = padding * 2;
    }
    return scene;
}
