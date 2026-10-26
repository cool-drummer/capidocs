import { BUILTIN_ICONS } from './icons.js';

export const DIAGRAM_VERSION = 1;

export const KINDS = ['graph', 'sequence'];
export const DIRECTIONS = ['LR', 'RL', 'TB', 'BT'];
export const DENSITIES = ['compact', 'comfortable'];
export const SHAPES = ['card', 'tile', 'pill', 'diamond', 'cylinder', 'circle', 'actor', 'note', 'table', 'text'];
export const COLORS = ['neutral', 'blue', 'sky', 'teal', 'green', 'lime', 'amber', 'orange', 'red', 'pink', 'violet', 'indigo'];
export const STATUSES = ['ok', 'warning', 'error', 'info', 'neutral'];
export const EDGE_STYLES = ['solid', 'dashed', 'dotted', 'thick'];
export const ARROWS = ['end', 'start', 'both', 'none'];
export const KEY_MARKS = ['pk', 'fk', 'uk'];
export const PREVIEW_TYPES = ['bars', 'sparkline'];
export const PARTICIPANT_KINDS = ['actor', 'system', 'store', 'queue', 'external'];
export const MESSAGE_STYLES = ['sync', 'async', 'reply'];
export const BLOCK_KINDS = ['loop', 'alt', 'opt', 'par', 'critical', 'break'];

export const DEFAULT_CATEGORIES = [
    { id: 'technical', title: 'Técnicos', description: 'Arquitectura, componentes, datos e infraestructura.', icon: 'cpu', color: 'blue' },
    { id: 'operational', title: 'Operativos', description: 'Procesos, flujos de trabajo y responsabilidades.', icon: 'workflow', color: 'teal' },
    { id: 'business', title: 'Negocio', description: 'Panorama general para dirección y clientes.', icon: 'briefcase', color: 'violet' }
];

export const LIMITS = {
    fileBytes: 5 * 1024 * 1024,
    diagrams: 200,
    nodes: 1000,
    edges: 3000,
    groups: 300,
    lanes: 24,
    steps: 200,
    items: 2000,
    props: 40,
    fields: 120,
    previewValues: 120,
    tags: 20,
    icons: 300,
    shortText: 200,
    longText: 8000,
    iconPath: 20000,
    depth: 12
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const ICON_REF = /^(?:brand:)?[a-z0-9][a-z0-9-]{0,63}$/;
const HEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const VIEWBOX = /^-?\d+(?:\.\d+)?(?:[ ,]+-?\d+(?:\.\d+)?){3}$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-.,\s]+$/;
const SAFE_HREF = /^(?:https?:\/\/|mailto:|#)[^\s<>"'`]*$/i;

class Collector {
    constructor() {
        this.issues = [];
    }

    add(path, message) {
        this.issues.push({ path: path || '(root)', message });
    }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkKeys(c, path, value, allowed) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) c.add(join(path, key), `Unknown key "${key}"`);
    }
}

function join(path, key) {
    return path ? `${path}.${key}` : String(key);
}

function text(c, path, value, { required = false, max = LIMITS.shortText } = {}) {
    if (value === undefined || value === null) {
        if (required) c.add(path, 'Required');
        return undefined;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        c.add(path, 'Expected text');
        return undefined;
    }
    const result = String(value).trim();
    if (required && !result) c.add(path, 'Must not be empty');
    if (result.length > max) c.add(path, `Longer than ${max} characters`);
    return result || undefined;
}

function oneOf(c, path, value, options, fallback) {
    if (value === undefined || value === null) return fallback;
    if (!options.includes(value)) {
        c.add(path, `Expected one of: ${options.join(', ')}`);
        return fallback;
    }
    return value;
}

function id(c, path, value, { required = true } = {}) {
    if (value === undefined || value === null) {
        if (required) c.add(path, 'Required');
        return undefined;
    }
    if (typeof value !== 'string' || !ID.test(value)) {
        c.add(path, 'Invalid identifier');
        return undefined;
    }
    return value;
}

function number(c, path, value, { min = -1e6, max = 1e6 } = {}) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        c.add(path, `Expected a number between ${min} and ${max}`);
        return undefined;
    }
    return value;
}

function bool(c, path, value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'boolean') {
        c.add(path, 'Expected true or false');
        return undefined;
    }
    return value;
}

function list(c, path, value, max) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        c.add(path, 'Expected a list');
        return [];
    }
    if (value.length > max) {
        c.add(path, `More than ${max} entries`);
        return value.slice(0, max);
    }
    return value;
}

function iconRef(c, path, value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || !ICON_REF.test(value)) {
        c.add(path, 'Invalid icon name');
        return undefined;
    }
    return value;
}

function href(c, path, value) {
    const result = text(c, path, value, { max: 2000 });
    if (result && !SAFE_HREF.test(result)) {
        c.add(path, 'Only http(s), mailto and # links are allowed');
        return undefined;
    }
    return result;
}

function uniqueIds(c, path, entries, label) {
    const seen = new Set();
    entries.forEach((entry, index) => {
        if (!entry?.id) return;
        if (seen.has(entry.id)) c.add(`${path}.${index}.id`, `Duplicate ${label} "${entry.id}"`);
        seen.add(entry.id);
    });
    return seen;
}

function normalizeIcon(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an icon object');
        return undefined;
    }
    checkKeys(c, path, value, ['viewBox', 'paths', 'color', 'stroke']);
    const viewBox = text(c, join(path, 'viewBox'), value.viewBox ?? '0 0 24 24');
    if (viewBox && !VIEWBOX.test(viewBox)) c.add(join(path, 'viewBox'), 'Invalid viewBox');
    const paths = list(c, join(path, 'paths'), value.paths, 32).map((entry, index) => {
        const itemPath = `${path}.paths.${index}`;
        if (typeof entry !== 'string' || !entry.trim() || entry.length > LIMITS.iconPath || !PATH_DATA.test(entry)) {
            c.add(itemPath, 'Invalid path data');
            return '';
        }
        return entry.trim();
    }).filter(Boolean);
    if (!paths.length) c.add(join(path, 'paths'), 'At least one path is required');
    const color = text(c, join(path, 'color'), value.color);
    if (color && !HEX.test(color)) c.add(join(path, 'color'), 'Expected a hex color');
    return { viewBox, paths, color: color && HEX.test(color) ? color : undefined, stroke: bool(c, join(path, 'stroke'), value.stroke) ?? false };
}

function normalizeBadge(c, path, value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return { text: text(c, path, value, { required: true, max: 40 }) };
    if (!isObject(value)) {
        c.add(path, 'Expected text or an object');
        return undefined;
    }
    checkKeys(c, path, value, ['text', 'color']);
    return {
        text: text(c, join(path, 'text'), value.text, { required: true, max: 40 }),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, undefined)
    };
}

function normalizeLink(c, path, value) {
    if (value === undefined || value === null) return undefined;
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return undefined;
    }
    checkKeys(c, path, value, ['diagram', 'node', 'href', 'label']);
    const link = {
        diagram: id(c, join(path, 'diagram'), value.diagram, { required: false }),
        node: id(c, join(path, 'node'), value.node, { required: false }),
        href: href(c, join(path, 'href'), value.href),
        label: text(c, join(path, 'label'), value.label, { max: 80 })
    };
    if (!link.diagram && !link.href) c.add(path, 'A link needs "diagram" or "href"');
    return link;
}

function normalizeProps(c, path, value) {
    return list(c, path, value, LIMITS.props).map((entry, index) => {
        const itemPath = `${path}.${index}`;
        if (!isObject(entry)) {
            c.add(itemPath, 'Expected an object');
            return null;
        }
        checkKeys(c, itemPath, entry, ['label', 'value', 'mono', 'status']);
        return {
            label: text(c, join(itemPath, 'label'), entry.label, { required: true, max: 60 }),
            value: text(c, join(itemPath, 'value'), entry.value, { required: true, max: 400 }),
            mono: bool(c, join(itemPath, 'mono'), entry.mono) ?? false,
            status: oneOf(c, join(itemPath, 'status'), entry.status, STATUSES, undefined)
        };
    }).filter(Boolean);
}

function normalizeFields(c, path, value) {
    return list(c, path, value, LIMITS.fields).map((entry, index) => {
        const itemPath = `${path}.${index}`;
        if (!isObject(entry)) {
            c.add(itemPath, 'Expected an object');
            return null;
        }
        checkKeys(c, itemPath, entry, ['name', 'type', 'key', 'note']);
        return {
            name: text(c, join(itemPath, 'name'), entry.name, { required: true, max: 80 }),
            type: text(c, join(itemPath, 'type'), entry.type, { max: 60 }),
            key: oneOf(c, join(itemPath, 'key'), entry.key, KEY_MARKS, undefined),
            note: text(c, join(itemPath, 'note'), entry.note, { max: 200 })
        };
    }).filter(Boolean);
}

function normalizePreview(c, path, value) {
    if (value === undefined || value === null) return undefined;
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return undefined;
    }
    checkKeys(c, path, value, ['type', 'values', 'labels', 'title']);
    const values = list(c, join(path, 'values'), value.values, LIMITS.previewValues)
        .map((entry, index) => number(c, `${path}.values.${index}`, entry))
        .filter((entry) => entry !== undefined);
    const labels = list(c, join(path, 'labels'), value.labels, LIMITS.previewValues)
        .map((entry, index) => text(c, `${path}.labels.${index}`, entry, { max: 40 }) ?? '');
    return {
        type: oneOf(c, join(path, 'type'), value.type, PREVIEW_TYPES, 'bars'),
        title: text(c, join(path, 'title'), value.title, { max: 60 }),
        values,
        labels
    };
}

function normalizeTags(c, path, value) {
    return list(c, path, value, LIMITS.tags)
        .map((entry, index) => text(c, `${path}.${index}`, entry, { max: 40 }))
        .filter(Boolean);
}

function normalizePoint(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected a point');
        return null;
    }
    checkKeys(c, path, value, ['x', 'y']);
    const x = number(c, join(path, 'x'), value.x);
    const y = number(c, join(path, 'y'), value.y);
    return x === undefined || y === undefined ? null : { x, y };
}

function normalizeNode(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, [
        'id', 'title', 'subtitle', 'description', 'shape', 'icon', 'badge', 'color', 'status', 'props', 'fields',
        'preview', 'group', 'lane', 'link', 'tags', 'expanded', 'x', 'y', 'w', 'h'
    ]);
    return {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 120 }),
        subtitle: text(c, join(path, 'subtitle'), value.subtitle, { max: 160 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        shape: oneOf(c, join(path, 'shape'), value.shape, SHAPES, 'card'),
        icon: iconRef(c, join(path, 'icon'), value.icon),
        badge: normalizeBadge(c, join(path, 'badge'), value.badge),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, undefined),
        status: oneOf(c, join(path, 'status'), value.status, STATUSES, undefined),
        props: normalizeProps(c, join(path, 'props'), value.props),
        fields: normalizeFields(c, join(path, 'fields'), value.fields),
        preview: normalizePreview(c, join(path, 'preview'), value.preview),
        group: id(c, join(path, 'group'), value.group, { required: false }),
        lane: id(c, join(path, 'lane'), value.lane, { required: false }),
        link: normalizeLink(c, join(path, 'link'), value.link),
        tags: normalizeTags(c, join(path, 'tags'), value.tags),
        expanded: bool(c, join(path, 'expanded'), value.expanded) ?? false,
        x: number(c, join(path, 'x'), value.x),
        y: number(c, join(path, 'y'), value.y),
        w: number(c, join(path, 'w'), value.w, { min: 8, max: 4000 }),
        h: number(c, join(path, 'h'), value.h, { min: 8, max: 4000 })
    };
}

function normalizeGroup(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'title', 'description', 'icon', 'color', 'parent', 'collapsed', 'link', 'tags', 'x', 'y', 'w', 'h']);
    return {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 120 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        icon: iconRef(c, join(path, 'icon'), value.icon),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, 'neutral'),
        parent: id(c, join(path, 'parent'), value.parent, { required: false }),
        collapsed: bool(c, join(path, 'collapsed'), value.collapsed) ?? false,
        link: normalizeLink(c, join(path, 'link'), value.link),
        tags: normalizeTags(c, join(path, 'tags'), value.tags),
        x: number(c, join(path, 'x'), value.x),
        y: number(c, join(path, 'y'), value.y),
        w: number(c, join(path, 'w'), value.w, { min: 8, max: 20000 }),
        h: number(c, join(path, 'h'), value.h, { min: 8, max: 20000 })
    };
}

function normalizeLane(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'title', 'description', 'icons', 'color']);
    return {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 80 }),
        description: text(c, join(path, 'description'), value.description, { max: 400 }),
        icons: list(c, join(path, 'icons'), value.icons, 6).map((entry, index) => iconRef(c, `${path}.icons.${index}`, entry)).filter(Boolean),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, 'neutral')
    };
}

function normalizeEdge(c, path, value, index) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'from', 'to', 'label', 'description', 'style', 'arrow', 'color', 'tags', 'points']);
    return {
        id: id(c, join(path, 'id'), value.id ?? `e${index + 1}`),
        from: id(c, join(path, 'from'), value.from),
        to: id(c, join(path, 'to'), value.to),
        label: text(c, join(path, 'label'), value.label, { max: 80 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        style: oneOf(c, join(path, 'style'), value.style, EDGE_STYLES, 'solid'),
        arrow: oneOf(c, join(path, 'arrow'), value.arrow, ARROWS, 'end'),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, undefined),
        tags: normalizeTags(c, join(path, 'tags'), value.tags),
        points: list(c, join(path, 'points'), value.points, 64).map((point, pointIndex) => normalizePoint(c, `${path}.points.${pointIndex}`, point)).filter(Boolean)
    };
}

function normalizeStep(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'title', 'description', 'nodes', 'edges', 'groups']);
    const refs = (key) => list(c, join(path, key), value[key], 200).map((entry, index) => id(c, `${path}.${key}.${index}`, entry)).filter(Boolean);
    return {
        id: id(c, join(path, 'id'), value.id, { required: false }),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 120 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        nodes: refs('nodes'),
        edges: refs('edges'),
        groups: refs('groups')
    };
}

function normalizeParticipant(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'title', 'subtitle', 'description', 'kind', 'icon', 'color', 'link']);
    return {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 80 }),
        subtitle: text(c, join(path, 'subtitle'), value.subtitle, { max: 120 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        kind: oneOf(c, join(path, 'kind'), value.kind, PARTICIPANT_KINDS, 'system'),
        icon: iconRef(c, join(path, 'icon'), value.icon),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, undefined),
        link: normalizeLink(c, join(path, 'link'), value.link)
    };
}

function normalizeItems(c, path, value, counter, depth) {
    if (depth > LIMITS.depth) {
        c.add(path, 'Blocks are nested too deeply');
        return [];
    }
    return list(c, path, value, LIMITS.items).map((entry, index) => {
        const itemPath = `${path}.${index}`;
        counter.count += 1;
        if (counter.count > LIMITS.items) {
            if (counter.count === LIMITS.items + 1) c.add(itemPath, `More than ${LIMITS.items} sequence items`);
            return null;
        }
        if (!isObject(entry)) {
            c.add(itemPath, 'Expected an object');
            return null;
        }
        const type = oneOf(c, join(itemPath, 'type'), entry.type, ['message', 'note', 'block'], 'message');
        if (type === 'message') {
            checkKeys(c, itemPath, entry, ['type', 'id', 'from', 'to', 'label', 'description', 'style']);
            return {
                type,
                id: id(c, join(itemPath, 'id'), entry.id ?? `m${counter.count}`),
                from: id(c, join(itemPath, 'from'), entry.from),
                to: id(c, join(itemPath, 'to'), entry.to),
                label: text(c, join(itemPath, 'label'), entry.label, { max: 160 }),
                description: text(c, join(itemPath, 'description'), entry.description, { max: LIMITS.longText }),
                style: oneOf(c, join(itemPath, 'style'), entry.style, MESSAGE_STYLES, 'sync')
            };
        }
        if (type === 'note') {
            checkKeys(c, itemPath, entry, ['type', 'id', 'over', 'text']);
            return {
                type,
                id: id(c, join(itemPath, 'id'), entry.id ?? `n${counter.count}`),
                over: list(c, join(itemPath, 'over'), entry.over, 2).map((ref, refIndex) => id(c, `${itemPath}.over.${refIndex}`, ref)).filter(Boolean),
                text: text(c, join(itemPath, 'text'), entry.text, { required: true, max: 400 })
            };
        }
        checkKeys(c, itemPath, entry, ['type', 'id', 'kind', 'label', 'items', 'branches']);
        return {
            type,
            id: id(c, join(itemPath, 'id'), entry.id ?? `b${counter.count}`),
            kind: oneOf(c, join(itemPath, 'kind'), entry.kind, BLOCK_KINDS, 'loop'),
            label: text(c, join(itemPath, 'label'), entry.label, { max: 120 }),
            items: normalizeItems(c, join(itemPath, 'items'), entry.items, counter, depth + 1),
            branches: list(c, join(itemPath, 'branches'), entry.branches, 12).map((branch, branchIndex) => {
                const branchPath = `${itemPath}.branches.${branchIndex}`;
                if (!isObject(branch)) {
                    c.add(branchPath, 'Expected an object');
                    return null;
                }
                checkKeys(c, branchPath, branch, ['label', 'items']);
                return {
                    label: text(c, join(branchPath, 'label'), branch.label, { max: 120 }),
                    items: normalizeItems(c, join(branchPath, 'items'), branch.items, counter, depth + 1)
                };
            }).filter(Boolean)
        };
    }).filter(Boolean);
}

function walkItems(items, visit) {
    for (const item of items) {
        visit(item);
        if (item.type === 'block') {
            walkItems(item.items, visit);
            item.branches.forEach((branch) => walkItems(branch.items, visit));
        }
    }
}

function normalizeDiagram(c, path, value, categories) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, [
        'id', 'title', 'description', 'category', 'kind', 'direction', 'density', 'tags',
        'lanes', 'groups', 'nodes', 'edges', 'steps', 'participants', 'items', 'autonumber'
    ]);
    const kind = oneOf(c, join(path, 'kind'), value.kind, KINDS, 'graph');
    const diagram = {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 120 }),
        description: text(c, join(path, 'description'), value.description, { max: LIMITS.longText }),
        category: id(c, join(path, 'category'), value.category, { required: false }) ?? categories[0]?.id,
        kind,
        direction: oneOf(c, join(path, 'direction'), value.direction, DIRECTIONS, 'LR'),
        density: oneOf(c, join(path, 'density'), value.density, DENSITIES, 'compact'),
        tags: normalizeTags(c, join(path, 'tags'), value.tags),
        lanes: list(c, join(path, 'lanes'), value.lanes, LIMITS.lanes).map((entry, index) => normalizeLane(c, `${path}.lanes.${index}`, entry)).filter(Boolean),
        groups: list(c, join(path, 'groups'), value.groups, LIMITS.groups).map((entry, index) => normalizeGroup(c, `${path}.groups.${index}`, entry)).filter(Boolean),
        nodes: list(c, join(path, 'nodes'), value.nodes, LIMITS.nodes).map((entry, index) => normalizeNode(c, `${path}.nodes.${index}`, entry)).filter(Boolean),
        edges: list(c, join(path, 'edges'), value.edges, LIMITS.edges).map((entry, index) => normalizeEdge(c, `${path}.edges.${index}`, entry, index)).filter(Boolean),
        steps: list(c, join(path, 'steps'), value.steps, LIMITS.steps).map((entry, index) => normalizeStep(c, `${path}.steps.${index}`, entry)).filter(Boolean),
        participants: list(c, join(path, 'participants'), value.participants, 60).map((entry, index) => normalizeParticipant(c, `${path}.participants.${index}`, entry)).filter(Boolean),
        items: normalizeItems(c, join(path, 'items'), value.items, { count: 0 }, 0),
        autonumber: bool(c, join(path, 'autonumber'), value.autonumber) ?? false
    };

    if (diagram.category && !categories.some((category) => category.id === diagram.category)) {
        c.add(join(path, 'category'), `Unknown category "${diagram.category}"`);
    }

    const laneIds = uniqueIds(c, join(path, 'lanes'), diagram.lanes, 'lane');
    const groupIds = uniqueIds(c, join(path, 'groups'), diagram.groups, 'group');
    const nodeIds = uniqueIds(c, join(path, 'nodes'), diagram.nodes, 'node');
    const edgeIds = uniqueIds(c, join(path, 'edges'), diagram.edges, 'edge');
    groupIds.forEach((groupId) => {
        if (nodeIds.has(groupId)) c.add(join(path, 'groups'), `"${groupId}" is used by a node and a group`);
    });

    diagram.groups.forEach((group, index) => {
        if (group.parent && !groupIds.has(group.parent)) c.add(`${path}.groups.${index}.parent`, `Unknown group "${group.parent}"`);
    });
    const parentOf = new Map(diagram.groups.map((group) => [group.id, group.parent]));
    diagram.groups.forEach((group, index) => {
        const seen = new Set([group.id]);
        let current = group.parent;
        while (current) {
            if (seen.has(current)) {
                c.add(`${path}.groups.${index}.parent`, 'Groups form a cycle');
                break;
            }
            seen.add(current);
            current = parentOf.get(current);
        }
    });

    diagram.nodes.forEach((node, index) => {
        if (node.group && !groupIds.has(node.group)) c.add(`${path}.nodes.${index}.group`, `Unknown group "${node.group}"`);
        if (node.lane && !laneIds.has(node.lane)) c.add(`${path}.nodes.${index}.lane`, `Unknown lane "${node.lane}"`);
    });

    diagram.edges.forEach((edge, index) => {
        ['from', 'to'].forEach((end) => {
            const ref = edge[end];
            if (ref && !nodeIds.has(ref) && !groupIds.has(ref)) c.add(`${path}.edges.${index}.${end}`, `Unknown node or group "${ref}"`);
        });
    });

    diagram.steps.forEach((step, index) => {
        step.nodes.forEach((ref) => { if (!nodeIds.has(ref) && !diagram.participants.some((p) => p.id === ref)) c.add(`${path}.steps.${index}.nodes`, `Unknown node "${ref}"`); });
        step.groups.forEach((ref) => { if (!groupIds.has(ref)) c.add(`${path}.steps.${index}.groups`, `Unknown group "${ref}"`); });
        if (kind === 'graph') step.edges.forEach((ref) => { if (!edgeIds.has(ref)) c.add(`${path}.steps.${index}.edges`, `Unknown edge "${ref}"`); });
    });

    if (kind === 'sequence') {
        const participantIds = uniqueIds(c, join(path, 'participants'), diagram.participants, 'participant');
        const messageIds = new Set();
        walkItems(diagram.items, (item) => {
            if (item.type === 'message') {
                messageIds.add(item.id);
                ['from', 'to'].forEach((end) => {
                    if (item[end] && !participantIds.has(item[end])) c.add(join(path, 'items'), `Message "${item.id}" references unknown participant "${item[end]}"`);
                });
            }
            if (item.type === 'note') {
                item.over.forEach((ref) => { if (!participantIds.has(ref)) c.add(join(path, 'items'), `Note "${item.id}" references unknown participant "${ref}"`); });
            }
        });
        diagram.steps.forEach((step, index) => {
            step.edges.forEach((ref) => { if (!messageIds.has(ref)) c.add(`${path}.steps.${index}.edges`, `Unknown message "${ref}"`); });
        });
        if (!diagram.participants.length) c.add(join(path, 'participants'), 'A sequence diagram needs participants');
    } else if (!diagram.nodes.length) {
        c.add(join(path, 'nodes'), 'A graph diagram needs nodes');
    }

    return diagram;
}

function normalizeCategory(c, path, value) {
    if (!isObject(value)) {
        c.add(path, 'Expected an object');
        return null;
    }
    checkKeys(c, path, value, ['id', 'title', 'description', 'icon', 'color']);
    return {
        id: id(c, join(path, 'id'), value.id),
        title: text(c, join(path, 'title'), value.title, { required: true, max: 60 }),
        description: text(c, join(path, 'description'), value.description, { max: 400 }),
        icon: iconRef(c, join(path, 'icon'), value.icon),
        color: oneOf(c, join(path, 'color'), value.color, COLORS, 'neutral')
    };
}

export function validateDiagramSet(input) {
    const c = new Collector();
    if (!isObject(input)) {
        c.add('', 'Expected a diagram set object');
        return { ok: false, set: null, issues: c.issues };
    }
    checkKeys(c, '', input, ['version', 'title', 'description', 'lang', 'categories', 'icons', 'start', 'diagrams']);
    if (input.version !== undefined && input.version !== DIAGRAM_VERSION) c.add('version', `Unsupported version ${input.version}`);

    const categories = input.categories === undefined
        ? DEFAULT_CATEGORIES.map((category) => ({ ...category }))
        : list(c, 'categories', input.categories, 24).map((entry, index) => normalizeCategory(c, `categories.${index}`, entry)).filter(Boolean);
    uniqueIds(c, 'categories', categories, 'category');
    categories.forEach((category, index) => {
        if (category.icon && BUILTIN_ICONS[category.icon] === undefined && !(isObject(input.icons) && input.icons[category.icon])) {
            c.add(`categories.${index}.icon`, `Unknown icon "${category.icon}"`);
        }
    });

    const icons = {};
    if (input.icons !== undefined) {
        if (!isObject(input.icons)) {
            c.add('icons', 'Expected an object');
        } else {
            const names = Object.keys(input.icons);
            if (names.length > LIMITS.icons) c.add('icons', `More than ${LIMITS.icons} icons`);
            names.slice(0, LIMITS.icons).forEach((name) => {
                if (!ICON_REF.test(name) || name.startsWith('brand:')) {
                    c.add(`icons.${name}`, 'Invalid icon name');
                    return;
                }
                const icon = normalizeIcon(c, `icons.${name}`, input.icons[name]);
                if (icon) icons[name] = icon;
            });
        }
    }

    const set = {
        version: DIAGRAM_VERSION,
        title: text(c, 'title', input.title, { required: true, max: 120 }),
        description: text(c, 'description', input.description, { max: LIMITS.longText }),
        lang: text(c, 'lang', input.lang, { max: 12 }) ?? 'es',
        categories,
        icons,
        start: id(c, 'start', input.start, { required: false }),
        diagrams: list(c, 'diagrams', input.diagrams, LIMITS.diagrams).map((entry, index) => normalizeDiagram(c, `diagrams.${index}`, entry, categories)).filter(Boolean)
    };

    if (!set.diagrams.length) c.add('diagrams', 'At least one diagram is required');
    const diagramIds = uniqueIds(c, 'diagrams', set.diagrams, 'diagram');
    if (set.start && !diagramIds.has(set.start)) c.add('start', `Unknown diagram "${set.start}"`);

    const nodeIndex = new Map(set.diagrams.map((diagram) => [diagram.id, new Set([
        ...diagram.nodes.map((node) => node.id),
        ...diagram.groups.map((group) => group.id),
        ...diagram.participants.map((participant) => participant.id)
    ])]));
    set.diagrams.forEach((diagram, diagramIndex) => {
        const check = (link, path) => {
            if (!link?.diagram) return;
            if (!diagramIds.has(link.diagram)) c.add(path, `Unknown diagram "${link.diagram}"`);
            else if (link.node && !nodeIndex.get(link.diagram).has(link.node)) c.add(path, `Unknown node "${link.node}" in "${link.diagram}"`);
        };
        diagram.nodes.forEach((node, index) => check(node.link, `diagrams.${diagramIndex}.nodes.${index}.link`));
        diagram.groups.forEach((group, index) => check(group.link, `diagrams.${diagramIndex}.groups.${index}.link`));
        diagram.participants.forEach((participant, index) => check(participant.link, `diagrams.${diagramIndex}.participants.${index}.link`));
        const icon = (name, path) => {
            if (name && set.icons[name] === undefined && BUILTIN_ICONS[name] === undefined) c.add(path, `Unknown icon "${name}"`);
        };
        diagram.nodes.forEach((node, index) => icon(node.icon, `diagrams.${diagramIndex}.nodes.${index}.icon`));
        diagram.groups.forEach((group, index) => icon(group.icon, `diagrams.${diagramIndex}.groups.${index}.icon`));
        diagram.participants.forEach((participant, index) => icon(participant.icon, `diagrams.${diagramIndex}.participants.${index}.icon`));
        diagram.lanes.forEach((lane, index) => lane.icons.forEach((name) => icon(name, `diagrams.${diagramIndex}.lanes.${index}.icons`)));
    });

    return c.issues.length ? { ok: false, set: null, issues: c.issues } : { ok: true, set, issues: [] };
}

export function parseDiagramSetJson(source) {
    if (typeof source !== 'string') return { ok: false, set: null, issues: [{ path: '(root)', message: 'Expected text' }] };
    if (source.length > LIMITS.fileBytes) return { ok: false, set: null, issues: [{ path: '(root)', message: 'File is too large' }] };
    let data;
    try {
        data = JSON.parse(source);
    } catch (error) {
        return { ok: false, set: null, issues: [{ path: '(root)', message: `Invalid JSON: ${error.message}` }] };
    }
    return validateDiagramSet(data);
}

export function findDiagram(set, diagramId) {
    return set.diagrams.find((diagram) => diagram.id === diagramId) ?? null;
}

export function mergeDiagramSets(base, incoming) {
    const taken = new Set(base.diagrams.map((diagram) => diagram.id));
    const renamed = new Map();
    const diagrams = incoming.diagrams.map((diagram) => {
        let next = diagram.id;
        let suffix = 2;
        while (taken.has(next)) next = `${diagram.id}-${suffix++}`;
        taken.add(next);
        if (next !== diagram.id) renamed.set(diagram.id, next);
        return { ...diagram, id: next };
    });
    const relink = (link) => (link?.diagram && renamed.has(link.diagram) ? { ...link, diagram: renamed.get(link.diagram) } : link);
    diagrams.forEach((diagram) => {
        diagram.nodes = diagram.nodes.map((node) => ({ ...node, link: relink(node.link) }));
        diagram.groups = diagram.groups.map((group) => ({ ...group, link: relink(group.link) }));
        diagram.participants = diagram.participants.map((participant) => ({ ...participant, link: relink(participant.link) }));
    });
    const categories = [...base.categories];
    incoming.categories.forEach((category) => {
        if (!categories.some((entry) => entry.id === category.id)) categories.push(category);
    });
    return validateDiagramSet({
        ...serializeDiagramSet(base),
        categories,
        icons: { ...incoming.icons, ...base.icons },
        diagrams: [...base.diagrams, ...diagrams].map(serializeDiagram)
    });
}

const EMPTY = (value) => value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0) || (isObject(value) && Object.keys(value).length === 0);

function compact(value) {
    if (Array.isArray(value)) return value.map(compact);
    if (!isObject(value)) return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (EMPTY(entry)) continue;
        result[key] = compact(entry);
    }
    return result;
}

function serializeDiagram(diagram) {
    const result = compact(diagram);
    if (diagram.kind === 'graph') {
        delete result.participants;
        delete result.items;
        delete result.autonumber;
    }
    if (result.kind === 'graph') delete result.kind;
    if (result.direction === 'LR') delete result.direction;
    if (result.density === 'compact') delete result.density;
    for (const node of result.nodes ?? []) {
        if (node.shape === 'card') delete node.shape;
    }
    for (const edge of result.edges ?? []) {
        if (edge.style === 'solid') delete edge.style;
        if (edge.arrow === 'end') delete edge.arrow;
    }
    for (const group of result.groups ?? []) {
        if (group.color === 'neutral') delete group.color;
    }
    for (const lane of result.lanes ?? []) {
        if (lane.color === 'neutral') delete lane.color;
    }
    return result;
}

export function serializeDiagramSet(set) {
    return {
        version: DIAGRAM_VERSION,
        ...compact({ title: set.title, description: set.description, lang: set.lang, categories: set.categories, icons: set.icons, start: set.start }),
        diagrams: set.diagrams.map(serializeDiagram)
    };
}

/**
 * Layout output consumed by the renderers. Coordinates are in diagram units (1 unit = 1 CSS px at zoom 1),
 * origin top-left, already including the outer padding.
 *
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 *
 * @typedef {Box & { id: string, title: string, description?: string, icons: string[], color: string, header: Box }} SceneLane
 * @typedef {Box & { id: string, title: string, icon?: string, color: string, depth: number, collapsed: boolean, header: Box, source: object }} SceneGroup
 * @typedef {Box & { id: string, shape: string, expanded: boolean, text: import('./metrics.js').NodeText, source: object }} SceneNode
 * @typedef {{ id: string, from: string, to: string, points: Point[], label?: string, labelBox?: Box, style: string, arrow: string, color?: string, source: object }} SceneEdge
 *
 * @typedef {{ kind: 'graph', width: number, height: number, direction: string, lanes: SceneLane[], groups: SceneGroup[], nodes: SceneNode[], edges: SceneEdge[] }} GraphScene
 *
 * @typedef {Box & { id: string, title: string, subtitle?: string, kind: string, icon?: string, color?: string, lifeline: { x: number, y1: number, y2: number }, source: object }} SceneParticipant
 * @typedef {{ id: string, index: number, from: string, to: string, y: number, x1: number, x2: number, self: boolean, label?: string, labelBox?: Box, style: string, source: object }} SceneMessage
 * @typedef {Box & { id: string, text: string }} SceneNote
 * @typedef {Box & { id: string, kind: string, label?: string, header: Box, dividers: { y: number, label?: string }[] }} SceneBlock
 *
 * @typedef {{ kind: 'sequence', width: number, height: number, participants: SceneParticipant[], messages: SceneMessage[], notes: SceneNote[], blocks: SceneBlock[] }} SequenceScene
 *
 * @typedef {GraphScene | SequenceScene} Scene
 */
