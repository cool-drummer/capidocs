const MARGIN = 10;
const BEND = 40;
const CROSS = 18;
const SHARE = 10;
const FOREIGN_GROUP = 1.8;
const SIDE_PENALTY = { preferred: 0, side: 90, back: 140 };
const STEP = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SIDES = ['E', 'S', 'W', 'N'];
const OUTWARD = { E: 0, S: 1, W: 2, N: 3 };
const PORT_GAP = 14;
const MAX_GRID_POINTS = 400000;

const reverse = (dir) => (dir + 2) % 4;
const horizontalSide = (side) => side === 'E' || side === 'W';
const round = (value) => Math.round(value * 2) / 2;

class Heap {
    constructor() {
        this.keys = [];
        this.values = [];
    }

    get size() {
        return this.values.length;
    }

    push(value, key) {
        const keys = this.keys;
        const values = this.values;
        let index = values.length;
        keys.push(key);
        values.push(value);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (keys[parent] < key || (keys[parent] === key && values[parent] <= value)) break;
            keys[index] = keys[parent];
            values[index] = values[parent];
            index = parent;
        }
        keys[index] = key;
        values[index] = value;
    }

    pop() {
        const keys = this.keys;
        const values = this.values;
        const top = values[0];
        const lastKey = keys.pop();
        const lastValue = values.pop();
        if (values.length) {
            let index = 0;
            const length = values.length;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                let smallestKey = lastKey;
                let smallestValue = lastValue;
                if (left < length && (keys[left] < smallestKey || (keys[left] === smallestKey && values[left] < smallestValue))) {
                    smallest = left;
                    smallestKey = keys[left];
                    smallestValue = values[left];
                }
                if (right < length && (keys[right] < smallestKey || (keys[right] === smallestKey && values[right] < smallestValue))) {
                    smallest = right;
                }
                if (smallest === index) break;
                keys[index] = keys[smallest];
                values[index] = values[smallest];
                index = smallest;
            }
            keys[index] = lastKey;
            values[index] = lastValue;
        }
        return top;
    }
}

function uniqueSorted(values) {
    return [...new Set(values.map(round))].sort((a, b) => a - b);
}

function lowerIndex(list, value) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] < value - 0.4) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function exactIndex(list, value) {
    const target = round(value);
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] === target) return mid;
        if (list[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

function inflate(box, amount) {
    return { x: box.x - amount, y: box.y - amount, w: box.w + amount * 2, h: box.h + amount * 2 };
}

class Grid {
    constructor({ obstacles, groups, xs, ys, frame }) {
        const obstacleX = [];
        const obstacleY = [];
        for (const box of obstacles) {
            obstacleX.push(box.x, box.x + box.w);
            obstacleY.push(box.y, box.y + box.h);
        }
        for (const box of groups) {
            obstacleX.push(box.x - MARGIN, box.x + box.w + MARGIN);
            obstacleY.push(box.y - MARGIN, box.y + box.h + MARGIN);
        }
        obstacleX.push(frame.x, frame.x + frame.w);
        obstacleY.push(frame.y, frame.y + frame.h);
        const withMid = (values) => {
            const base = uniqueSorted(values);
            const mids = [];
            for (let i = 0; i + 1 < base.length; i += 1) if (base[i + 1] - base[i] > 16) mids.push((base[i] + base[i + 1]) / 2);
            return [...base, ...mids];
        };
        this.xs = uniqueSorted([...withMid(obstacleX), ...xs]);
        this.ys = uniqueSorted([...withMid(obstacleY), ...ys]);
        this.nx = this.xs.length;
        this.ny = this.ys.length;
        const size = this.nx * this.ny;
        this.size = size;
        this.blockedPoint = new Uint8Array(size);
        this.blockedH = new Uint8Array(size);
        this.blockedV = new Uint8Array(size);
        for (const box of obstacles) this.markObstacle(box);
        this.groupMask = new Float64Array(size);
        groups.slice(0, 48).forEach((box, index) => this.markGroup(inflate(box, MARGIN - 1), 2 ** index));
    }

    range(list, low, high) {
        let start = lowerIndex(list, low);
        while (start < list.length && list[start] <= low + 0.4) start += 1;
        let end = start;
        while (end < list.length && list[end] < high - 0.4) end += 1;
        return [start, end];
    }

    markObstacle(box) {
        const [i0, i1] = this.range(this.xs, box.x, box.x + box.w);
        const [j0, j1] = this.range(this.ys, box.y, box.y + box.h);
        const iEdge0 = Math.max(0, i0 - 1);
        const jEdge0 = Math.max(0, j0 - 1);
        for (let j = j0; j < j1; j += 1) {
            for (let i = i0; i < i1; i += 1) this.blockedPoint[j * this.nx + i] = 1;
            for (let i = iEdge0; i < Math.min(i1, this.nx - 1); i += 1) this.blockedH[j * this.nx + i] = 1;
        }
        for (let i = i0; i < i1; i += 1) {
            for (let j = jEdge0; j < Math.min(j1, this.ny - 1); j += 1) this.blockedV[j * this.nx + i] = 1;
        }
    }

    markGroup(box, bit) {
        const [i0, i1] = this.range(this.xs, box.x, box.x + box.w);
        const [j0, j1] = this.range(this.ys, box.y, box.y + box.h);
        for (let j = j0; j < j1; j += 1) {
            for (let i = i0; i < i1; i += 1) this.groupMask[j * this.nx + i] += bit;
        }
    }

    index(x, y) {
        const i = exactIndex(this.xs, x);
        const j = exactIndex(this.ys, y);
        return i < 0 || j < 0 ? -1 : j * this.nx + i;
    }
}

function maskHas(mask, related) {
    let rest = mask;
    let rel = related;
    let bit = 1;
    while (rest > 0) {
        const hasBit = rest % 2 === 1;
        const relBit = rel % 2 === 1;
        if (hasBit && !relBit) return true;
        rest = Math.floor(rest / 2);
        rel = Math.floor(rel / 2);
        bit *= 2;
        if (bit > 2 ** 52) break;
    }
    return false;
}

function search(grid, starts, goals, related, usage) {
    const { nx, ny, xs, ys } = grid;
    const states = grid.size * 4;
    const cost = new Float64Array(states).fill(Infinity);
    const from = new Int32Array(states).fill(-1);
    const closed = new Uint8Array(states);
    const heap = new Heap();
    const goalByPoint = new Map();
    for (const goal of goals) {
        if (!goalByPoint.has(goal.point)) goalByPoint.set(goal.point, []);
        goalByPoint.get(goal.point).push(goal);
    }
    const goalCoords = goals.map((goal) => ({ x: xs[goal.point % nx], y: ys[Math.floor(goal.point / nx)] }));
    const heuristic = (point) => {
        const x = xs[point % nx];
        const y = ys[Math.floor(point / nx)];
        let best = Infinity;
        for (const goal of goalCoords) {
            const dx = Math.abs(goal.x - x);
            const dy = Math.abs(goal.y - y);
            best = Math.min(best, dx + dy);
        }
        return best;
    };
    for (const start of starts) {
        const state = start.point * 4 + start.dir;
        if (start.cost < cost[state]) {
            cost[state] = start.cost;
            heap.push(state, start.cost + heuristic(start.point));
        }
    }
    let bestGoal = null;
    let bestTotal = Infinity;
    const foreignCache = new Map();
    const foreign = (mask) => {
        if (!mask) return false;
        if (!foreignCache.has(mask)) foreignCache.set(mask, maskHas(mask, related));
        return foreignCache.get(mask);
    };
    while (heap.size) {
        const state = heap.pop();
        if (closed[state]) continue;
        closed[state] = 1;
        const g = cost[state];
        if (g + 0 >= bestTotal) break;
        const point = state >> 2;
        const dir = state & 3;
        const arrivals = goalByPoint.get(point);
        if (arrivals) {
            for (const goal of arrivals) {
                if (dir === reverse(goal.inward)) continue;
                const total = g + goal.cost + (dir === goal.inward ? 0 : BEND);
                if (total < bestTotal) {
                    bestTotal = total;
                    bestGoal = { state, goal };
                }
            }
        }
        const i = point % nx;
        const j = (point - i) / nx;
        for (let next = 0; next < 4; next += 1) {
            if (next === reverse(dir)) continue;
            const ni = i + STEP[next][0];
            const nj = j + STEP[next][1];
            if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
            const target = nj * nx + ni;
            if (grid.blockedPoint[target]) continue;
            if (next === 0 && grid.blockedH[point]) continue;
            if (next === 2 && grid.blockedH[target]) continue;
            if (next === 1 && grid.blockedV[point]) continue;
            if (next === 3 && grid.blockedV[target]) continue;
            const length = next % 2 === 0 ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
            let step = length;
            if (foreign(grid.groupMask[point]) || foreign(grid.groupMask[target])) step *= FOREIGN_GROUP;
            if (next !== dir) step += BEND;
            if (next % 2 === 0) {
                if (usage.v[target]) step += CROSS;
                if (usage.h[point] && usage.h[target]) step += SHARE;
            } else {
                if (usage.h[target]) step += CROSS;
                if (usage.v[point] && usage.v[target]) step += SHARE;
            }
            const nextState = target * 4 + next;
            const value = g + step;
            if (value < cost[nextState]) {
                cost[nextState] = value;
                from[nextState] = state;
                heap.push(nextState, value + heuristic(target));
            }
        }
    }
    if (!bestGoal) return null;
    const pointsList = [];
    let state = bestGoal.state;
    while (state >= 0) {
        pointsList.push(state >> 2);
        state = from[state];
    }
    pointsList.reverse();
    return { points: pointsList.map((point) => ({ x: xs[point % nx], y: ys[Math.floor(point / nx)] })), raw: pointsList, goal: bestGoal.goal };
}

export function simplify(points) {
    const result = [];
    for (const point of points) {
        const last = result[result.length - 1];
        if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
        result.push({ x: point.x, y: point.y });
        while (result.length >= 3) {
            const [a, b, c] = result.slice(-3);
            const collinear = (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
            if (!collinear) break;
            result.splice(result.length - 2, 1);
        }
    }
    return result;
}

function anchor(endpoint, side) {
    const box = endpoint.box;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const shape = endpoint.shape;
    if (shape === 'tile' && endpoint.square) {
        const sq = endpoint.square;
        const scx = sq.x + sq.w / 2;
        const scy = sq.y + sq.h / 2;
        if (side === 'E') return { x: sq.x + sq.w, y: scy, min: scy, max: scy };
        if (side === 'W') return { x: sq.x, y: scy, min: scy, max: scy };
        if (side === 'N') return { x: scx, y: sq.y, min: sq.x + 14, max: sq.x + sq.w - 14 };
        return { x: cx, y: bottom, min: cx, max: cx };
    }
    if (shape === 'actor' && endpoint.figure) {
        const fig = endpoint.figure;
        const fcy = fig.y + fig.h / 2;
        if (side === 'E') return { x: fig.x + fig.w, y: fcy, min: fcy, max: fcy };
        if (side === 'W') return { x: fig.x, y: fcy, min: fcy, max: fcy };
        if (side === 'N') return { x: cx, y: fig.y, min: cx, max: cx };
        return { x: cx, y: bottom, min: cx, max: cx };
    }
    if (shape === 'circle' || shape === 'diamond') {
        const spreadY = shape === 'circle' ? box.h * 0.22 : box.h * 0.18;
        const spreadX = shape === 'circle' ? box.w * 0.22 : box.w * 0.18;
        if (side === 'E') return { x: right, y: cy, min: cy - spreadY, max: cy + spreadY };
        if (side === 'W') return { x: box.x, y: cy, min: cy - spreadY, max: cy + spreadY };
        if (side === 'N') return { x: cx, y: box.y, min: cx - spreadX, max: cx + spreadX };
        return { x: cx, y: bottom, min: cx - spreadX, max: cx + spreadX };
    }
    const radius = shape === 'pill' ? box.h / 2 : Math.min(14, box.h / 3, box.w / 3);
    if (side === 'E') return { x: right, y: cy, min: box.y + radius, max: bottom - radius };
    if (side === 'W') return { x: box.x, y: cy, min: box.y + radius, max: bottom - radius };
    if (side === 'N') return { x: cx, y: box.y, min: box.x + Math.max(radius, 14), max: right - Math.max(radius, 14) };
    return { x: cx, y: bottom, min: box.x + Math.max(radius, 14), max: right - Math.max(radius, 14) };
}

function fitToOutline(endpoint, side, port) {
    const box = endpoint.box;
    if (endpoint.shape !== 'circle' && endpoint.shape !== 'diamond') return port;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const rx = box.w / 2;
    const ry = box.h / 2;
    const horizontal = horizontalSide(side);
    const offset = horizontal ? (port.y - cy) / ry : (port.x - cx) / rx;
    const reach = endpoint.shape === 'circle' ? Math.sqrt(Math.max(0, 1 - offset * offset)) : Math.max(0, 1 - Math.abs(offset));
    const sign = side === 'E' || side === 'S' ? 1 : -1;
    return horizontal
        ? { x: round(cx + sign * rx * reach), y: port.y }
        : { x: port.x, y: round(cy + sign * ry * reach) };
}

function stubFor(endpoint, side, port) {
    const box = endpoint.clearance;
    if (side === 'E') return { x: box.x + box.w + MARGIN, y: port.y };
    if (side === 'W') return { x: box.x - MARGIN, y: port.y };
    if (side === 'S') return { x: port.x, y: box.y + box.h + MARGIN };
    return { x: port.x, y: box.y - MARGIN };
}

function centerOf(box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function preferredSides(source, target, direction, manual) {
    const a = centerOf(source.box);
    const b = centerOf(target.box);
    const facing = () => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['E', 'W'] : ['W', 'E'];
        return dy >= 0 ? ['S', 'N'] : ['N', 'S'];
    };
    if (manual) return facing();
    const flow = { LR: ['E', 'W'], RL: ['W', 'E'], TB: ['S', 'N'], BT: ['N', 'S'] }[direction] ?? ['E', 'W'];
    const s = source.box;
    const t = target.box;
    const ahead = {
        LR: t.x >= s.x + s.w - 1,
        RL: t.x + t.w <= s.x + 1,
        TB: t.y >= s.y + s.h - 1,
        BT: t.y + t.h <= s.y + 1
    }[direction] ?? true;
    return ahead ? flow : facing();
}

function sidePenalty(side, preferred) {
    if (side === preferred) return SIDE_PENALTY.preferred;
    if (horizontalSide(side) === horizontalSide(preferred)) return SIDE_PENALTY.back;
    return SIDE_PENALTY.side;
}

function fallbackRoute(source, target, sides) {
    const [startSide, endSide] = sides;
    const start = anchor(source, startSide);
    const end = anchor(target, endSide);
    if (horizontalSide(startSide) && horizontalSide(endSide)) {
        const mid = (start.x + end.x) / 2;
        return simplify([start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]);
    }
    if (!horizontalSide(startSide) && !horizontalSide(endSide)) {
        const mid = (start.y + end.y) / 2;
        return simplify([start, { x: start.x, y: mid }, { x: end.x, y: mid }, end]);
    }
    return horizontalSide(startSide)
        ? simplify([start, { x: end.x, y: start.y }, end])
        : simplify([start, { x: start.x, y: end.y }, end]);
}

function selfLoop(endpoint, direction) {
    const box = endpoint.box;
    const vertical = direction === 'TB' || direction === 'BT';
    if (vertical) {
        const y1 = box.y + box.h * 0.35;
        const y2 = box.y + box.h * 0.7;
        const x = box.x + box.w + 26;
        return { points: [{ x: box.x + box.w, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: box.x + box.w, y: y2 }], sides: ['E', 'E'] };
    }
    const x1 = box.x + box.w * 0.62;
    const x2 = box.x + box.w * 0.86;
    const y = box.y + box.h + 26;
    return { points: [{ x: x1, y: box.y + box.h }, { x: x1, y }, { x: x2, y }, { x: x2, y: box.y + box.h }], sides: ['S', 'S'] };
}

function throughPoints(source, target, waypoints) {
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    const sideToward = (endpoint, point) => {
        const box = endpoint.box;
        if (point.x >= box.x + box.w) return 'E';
        if (point.x <= box.x) return 'W';
        if (point.y >= box.y + box.h) return 'S';
        return 'N';
    };
    const startSide = sideToward(source, first);
    const endSide = sideToward(target, last);
    const start = anchor(source, startSide);
    const end = anchor(target, endSide);
    if (horizontalSide(startSide)) start.y = Math.min(start.max, Math.max(start.min, first.y));
    else start.x = Math.min(start.max, Math.max(start.min, first.x));
    if (horizontalSide(endSide)) end.y = Math.min(end.max, Math.max(end.min, last.y));
    else end.x = Math.min(end.max, Math.max(end.min, last.x));
    const raw = [start, ...waypoints, end];
    const points = [raw[0]];
    for (let index = 1; index < raw.length; index += 1) {
        const prev = points[points.length - 1];
        const next = raw[index];
        if (Math.abs(prev.x - next.x) > 0.5 && Math.abs(prev.y - next.y) > 0.5) {
            const firstLeg = index === 1 ? horizontalSide(startSide) : Math.abs(points[points.length - 1].y - (points[points.length - 2]?.y ?? prev.y)) < 0.5;
            points.push(firstLeg ? { x: next.x, y: prev.y } : { x: prev.x, y: next.y });
        }
        points.push({ x: next.x, y: next.y });
    }
    return { points: simplify(points), sides: [startSide, endSide] };
}

function markUsage(grid, usage, points) {
    for (let index = 0; index + 1 < points.length; index += 1) {
        const a = points[index];
        const b = points[index + 1];
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        if (horizontal) {
            const j = exactIndex(grid.ys, a.y);
            if (j < 0) continue;
            const [lo, hi] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
            for (let i = lowerIndex(grid.xs, lo); i < grid.nx && grid.xs[i] <= hi + 0.4; i += 1) usage.h[j * grid.nx + i] = 1;
        } else {
            const i = exactIndex(grid.xs, a.x);
            if (i < 0) continue;
            const [lo, hi] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
            for (let j = lowerIndex(grid.ys, lo); j < grid.ny && grid.ys[j] <= hi + 0.4; j += 1) usage.v[j * grid.nx + i] = 1;
        }
    }
}

function relatedMask(groupIndex, endpointAncestors) {
    let mask = 0;
    for (const id of endpointAncestors) {
        const index = groupIndex.get(id);
        if (index !== undefined && index < 48) mask += 2 ** index;
    }
    return mask;
}

function routeAll({ edges, endpoints, obstacles, groups, direction, manual, fixed }) {
    const inflated = obstacles.map((box) => inflate(box, MARGIN));
    const extraX = [];
    const extraY = [];
    const plans = edges.map((edge) => {
        const source = endpoints.get(edge.from);
        const target = endpoints.get(edge.to);
        const preferred = preferredSides(source, target, direction, manual);
        const choice = fixed?.get(edge.id);
        const startSides = choice ? [choice.startSide] : SIDES;
        const endSides = choice ? [choice.endSide] : SIDES;
        const starts = startSides.map((side) => {
            const port = choice ? choice.start : anchor(source, side);
            const stub = stubFor(source, side, port);
            return { side, port, stub, cost: sidePenalty(side, preferred[0]) };
        });
        const ends = endSides.map((side) => {
            const port = choice ? choice.end : anchor(target, side);
            const stub = stubFor(target, side, port);
            return { side, port, stub, cost: sidePenalty(side, preferred[1]) };
        });
        for (const entry of [...starts, ...ends]) {
            extraX.push(entry.stub.x, entry.port.x);
            extraY.push(entry.stub.y, entry.port.y);
        }
        return { edge, source, target, starts, ends };
    });
    const all = [...inflated, ...groups.map((group) => group.box)];
    const minX = Math.min(...all.map((box) => box.x), ...extraX) - MARGIN * 4;
    const minY = Math.min(...all.map((box) => box.y), ...extraY) - MARGIN * 4;
    const maxX = Math.max(...all.map((box) => box.x + box.w), ...extraX) + MARGIN * 4;
    const maxY = Math.max(...all.map((box) => box.y + box.h), ...extraY) + MARGIN * 4;
    const frame = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const grid = new Grid({ obstacles: inflated, groups: groups.map((group) => group.box), xs: extraX, ys: extraY, frame });
    const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
    const usage = { h: new Uint8Array(grid.size), v: new Uint8Array(grid.size) };
    const tooLarge = grid.size > MAX_GRID_POINTS;
    const results = new Map();
    const order = plans.map((plan, index) => ({ plan, index }))
        .sort((a, b) => {
            const da = Math.abs(centerOf(a.plan.source.box).x - centerOf(a.plan.target.box).x) + Math.abs(centerOf(a.plan.source.box).y - centerOf(a.plan.target.box).y);
            const db = Math.abs(centerOf(b.plan.source.box).x - centerOf(b.plan.target.box).x) + Math.abs(centerOf(b.plan.source.box).y - centerOf(b.plan.target.box).y);
            return da - db || a.index - b.index;
        });
    for (const { plan } of order) {
        const starts = [];
        const goals = [];
        if (!tooLarge) {
            for (const start of plan.starts) {
                const point = grid.index(start.stub.x, start.stub.y);
                if (point >= 0 && !grid.blockedPoint[point]) starts.push({ point, dir: OUTWARD[start.side], cost: start.cost, entry: start });
            }
            for (const end of plan.ends) {
                const point = grid.index(end.stub.x, end.stub.y);
                if (point >= 0 && !grid.blockedPoint[point]) goals.push({ point, inward: reverse(OUTWARD[end.side]), cost: end.cost, entry: end });
            }
        }
        const related = relatedMask(groupIndex, [...plan.source.ancestors, ...plan.target.ancestors]);
        const found = starts.length && goals.length ? search(grid, starts, goals, related, usage) : null;
        let points;
        let sides;
        if (found) {
            const startPoint = found.points[0];
            const start = plan.starts.find((entry) => Math.abs(entry.stub.x - startPoint.x) < 0.8 && Math.abs(entry.stub.y - startPoint.y) < 0.8) ?? plan.starts[0];
            const end = found.goal.entry;
            points = simplify([start.port, ...found.points, end.port]);
            sides = [start.side, end.side];
        } else {
            const preferred = preferredSides(plan.source, plan.target, direction, manual);
            sides = fixed?.get(plan.edge.id) ? [fixed.get(plan.edge.id).startSide, fixed.get(plan.edge.id).endSide] : preferred;
            points = fixed?.get(plan.edge.id)
                ? fallbackFixed(fixed.get(plan.edge.id))
                : fallbackRoute(plan.source, plan.target, sides);
        }
        markUsage(grid, usage, points);
        results.set(plan.edge.id, { points, sides });
    }
    return results;
}

function fallbackFixed(choice) {
    const { start, end, startSide, endSide } = choice;
    if (horizontalSide(startSide) && horizontalSide(endSide)) {
        const mid = (start.x + end.x) / 2;
        return simplify([start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]);
    }
    if (!horizontalSide(startSide) && !horizontalSide(endSide)) {
        const mid = (start.y + end.y) / 2;
        return simplify([start, { x: start.x, y: mid }, { x: end.x, y: mid }, end]);
    }
    return horizontalSide(startSide) ? simplify([start, { x: end.x, y: start.y }, end]) : simplify([start, { x: start.x, y: end.y }, end]);
}

function assignPorts(edges, endpoints, firstPass) {
    const bySide = new Map();
    const add = (endpointId, side, edge, end, other) => {
        const key = `${endpointId}|${side}`;
        if (!bySide.has(key)) bySide.set(key, []);
        bySide.get(key).push({ edge, end, other });
    };
    for (const edge of edges) {
        const route = firstPass.get(edge.id);
        if (!route) continue;
        const [startSide, endSide] = route.sides;
        const points = route.points;
        add(edge.from, startSide, edge, 'start', points[Math.min(2, points.length - 1)]);
        add(edge.to, endSide, edge, 'end', points[Math.max(0, points.length - 3)]);
    }
    const ports = new Map();
    for (const [key, entries] of bySide) {
        const [endpointId, side] = key.split('|');
        const endpoint = endpoints.get(endpointId);
        const base = anchor(endpoint, side);
        const along = horizontalSide(side) ? 'y' : 'x';
        entries.sort((a, b) => (a.other[along] - b.other[along]) || String(a.edge.id).localeCompare(String(b.edge.id)));
        const span = base.max - base.min;
        const gap = entries.length > 1 ? Math.min(PORT_GAP, span / (entries.length - 1)) : 0;
        entries.forEach((entry, index) => {
            const offset = (index - (entries.length - 1) / 2) * gap;
            const port = { x: base.x, y: base.y };
            port[along] = round(Math.min(base.max, Math.max(base.min, base[along] + offset)));
            ports.set(`${entry.edge.id}|${entry.end}`, { port: fitToOutline(endpoint, side, port), side, alone: entries.length === 1, base, endpoint });
        });
    }
    const fixed = new Map();
    for (const edge of edges) {
        const start = ports.get(`${edge.id}|start`);
        const end = ports.get(`${edge.id}|end`);
        if (!start || !end) continue;
        const along = horizontalSide(start.side) ? 'y' : 'x';
        const opposite = horizontalSide(start.side) === horizontalSide(end.side) && start.side !== end.side;
        if (opposite) {
            if (end.alone && start.port[along] >= end.base.min && start.port[along] <= end.base.max) {
                end.port = fitToOutline(end.endpoint, end.side, { ...end.port, [along]: start.port[along] });
            } else if (start.alone && end.port[along] >= start.base.min && end.port[along] <= start.base.max) {
                start.port = fitToOutline(start.endpoint, start.side, { ...start.port, [along]: end.port[along] });
            }
        }
        fixed.set(edge.id, { start: start.port, end: end.port, startSide: start.side, endSide: end.side });
    }
    return fixed;
}

function segmentHitsBox(a, b, box) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxX > box.x + 0.5 && minX < box.x + box.w - 0.5 && maxY > box.y + 0.5 && minY < box.y + box.h - 0.5;
}

function nudge(routes, obstacles) {
    const blocked = obstacles.map((box) => inflate(box, 3));
    for (const axis of ['h', 'v']) {
        const segments = [];
        for (const [id, route] of routes) {
            const points = route.points;
            for (let index = 1; index + 2 < points.length; index += 1) {
                const a = points[index];
                const b = points[index + 1];
                const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5;
                const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5;
                if ((axis === 'h' && !horizontal) || (axis === 'v' && !vertical)) continue;
                const coord = axis === 'h' ? a.y : a.x;
                const lo = axis === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
                const hi = axis === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
                const prev = points[index - 1];
                const next = points[index + 2];
                const across = axis === 'h' ? 'y' : 'x';
                const along = axis === 'h' ? 'x' : 'y';
                const fromPrev = Math.sign(a[across] - prev[across]);
                const toNext = Math.sign(next[across] - b[across]);
                const flow = fromPrev === toNext ? fromPrev : 0;
                const key = flow
                    ? flow * (Math.sign(b[along] - a[along]) > 0 ? -a[along] : a[along])
                    : (prev[across] + next[across]) / 2;
                segments.push({ id, index, coord: round(coord), lo, hi, key });
            }
        }
        const byCoord = new Map();
        for (const segment of segments) {
            if (!byCoord.has(segment.coord)) byCoord.set(segment.coord, []);
            byCoord.get(segment.coord).push(segment);
        }
        for (const [coord, list] of [...byCoord.entries()].sort((a, b) => a[0] - b[0])) {
            list.sort((a, b) => a.lo - b.lo);
            const clusters = [];
            for (const segment of list) {
                const cluster = clusters[clusters.length - 1];
                if (cluster && segment.lo < cluster.hi - 1 && cluster.items.some((item) => item.id !== segment.id)) {
                    cluster.items.push(segment);
                    cluster.hi = Math.max(cluster.hi, segment.hi);
                } else if (cluster && segment.lo < cluster.hi - 1) {
                    cluster.items.push(segment);
                    cluster.hi = Math.max(cluster.hi, segment.hi);
                } else {
                    clusters.push({ items: [segment], hi: segment.hi });
                }
            }
            for (const cluster of clusters) {
                const ids = new Set(cluster.items.map((item) => item.id));
                if (ids.size < 2) continue;
                const items = [...cluster.items].sort((a, b) => a.key - b.key || String(a.id).localeCompare(String(b.id)));
                for (const spacing of [8, 5, 3]) {
                    const moves = items.map((item, position) => ({ item, value: coord + (position - (items.length - 1) / 2) * spacing }));
                    const fits = moves.every(({ item, value }) => {
                        const points = routes.get(item.id).points;
                        const oldA = points[item.index];
                        const oldB = points[item.index + 1];
                        const a = { ...oldA };
                        const b = { ...oldB };
                        if (axis === 'h') { a.y = value; b.y = value; } else { a.x = value; b.x = value; }
                        return !blocked.some((box) => segmentHitsBox(a, b, box) || segmentHitsBox(oldA, a, box) || segmentHitsBox(oldB, b, box));
                    });
                    if (!fits) continue;
                    for (const { item, value } of moves) {
                        const points = routes.get(item.id).points;
                        if (axis === 'h') {
                            points[item.index].y = value;
                            points[item.index + 1].y = value;
                        } else {
                            points[item.index].x = value;
                            points[item.index + 1].x = value;
                        }
                    }
                    break;
                }
            }
        }
    }
}

function centerSegments(routes, obstacles, groups, endpoints, edges) {
    const blocked = obstacles.map((box) => inflate(box, MARGIN));
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
    const minLeg = 12;
    for (const [id, route] of routes) {
        const edge = edgeById.get(id);
        const related = new Set([...(endpoints.get(edge.from)?.ancestors ?? []), ...(endpoints.get(edge.to)?.ancestors ?? [])]);
        const walls = [...blocked, ...groups.filter((group) => !related.has(group.id)).map((group) => inflate(group.box, MARGIN))];
        const points = route.points;
        for (let index = 1; index + 2 < points.length; index += 1) {
            const a = points[index];
            const b = points[index + 1];
            const prev = points[index - 1];
            const next = points[index + 2];
            const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5;
            const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5;
            if (!vertical && !horizontal) continue;
            const along = vertical ? 'x' : 'y';
            const across = vertical ? 'y' : 'x';
            const current = a[along];
            const fromPrev = Math.sign(current - prev[along]);
            const toNext = Math.sign(next[along] - current);
            if (!fromPrev || fromPrev !== toNext) continue;
            const prevLeg = index === 1 ? MARGIN : minLeg;
            const nextLeg = index + 2 === points.length - 1 ? MARGIN : minLeg;
            let lo = fromPrev > 0 ? prev[along] + prevLeg : next[along] + nextLeg;
            let hi = fromPrev > 0 ? next[along] - nextLeg : prev[along] - prevLeg;
            const spanLo = Math.min(a[across], b[across]);
            const spanHi = Math.max(a[across], b[across]);
            for (const wall of walls) {
                const wallLo = along === 'x' ? wall.x : wall.y;
                const wallHi = along === 'x' ? wall.x + wall.w : wall.y + wall.h;
                const crossLo = across === 'y' ? wall.y : wall.x;
                const crossHi = across === 'y' ? wall.y + wall.h : wall.x + wall.w;
                const touchesSpan = crossHi > spanLo + 0.5 && crossLo < spanHi - 0.5;
                const touchesPrevLeg = prev[across] > crossLo + 0.5 && prev[across] < crossHi - 0.5;
                const touchesNextLeg = next[across] > crossLo + 0.5 && next[across] < crossHi - 0.5;
                if (!touchesSpan && !touchesPrevLeg && !touchesNextLeg) continue;
                if (wallHi <= current + 0.5) lo = Math.max(lo, wallHi);
                else if (wallLo >= current - 0.5) hi = Math.min(hi, wallLo);
                else {
                    lo = Infinity;
                    break;
                }
            }
            if (!(lo <= current + 0.5 && hi >= current - 0.5)) continue;
            const target = round((lo + hi) / 2);
            a[along] = target;
            b[along] = target;
        }
    }
}

function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

function pathLength(points) {
    let total = 0;
    for (let index = 0; index + 1 < points.length; index += 1) total += Math.abs(points[index + 1].x - points[index].x) + Math.abs(points[index + 1].y - points[index].y);
    return total;
}

export function placeLabels(edges, routes, obstacles, chips, direction) {
    const placed = [];
    const boxes = new Map();
    const preferHorizontal = direction === 'LR' || direction === 'RL';
    const allSegments = [];
    for (const [id, route] of routes) {
        for (let index = 0; index + 1 < route.points.length; index += 1) allSegments.push({ id, a: route.points[index], b: route.points[index + 1] });
    }
    for (const edge of edges) {
        if (!edge.labelSize) continue;
        const route = routes.get(edge.id);
        if (!route) continue;
        const { w, h } = edge.labelSize;
        const points = route.points;
        const total = pathLength(points);
        let travelled = 0;
        let best = null;
        for (let index = 0; index + 1 < points.length; index += 1) {
            const a = points[index];
            const b = points[index + 1];
            const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
            const horizontal = Math.abs(a.y - b.y) < 0.5;
            const offsets = horizontal ? [[0, 0], [0, -(h / 2 + 3)], [0, h / 2 + 3]] : [[0, 0], [-(w / 2 + 3), 0], [w / 2 + 3, 0]];
            for (const [fraction, [dx, dy]] of [0.5, 0.35, 0.65, 0.2, 0.8].flatMap((value) => offsets.map((offset) => [value, offset]))) {
                const x = a.x + (b.x - a.x) * fraction + dx;
                const y = a.y + (b.y - a.y) * fraction + dy;
                const box = { x: x - w / 2, y: y - h / 2, w, h };
                const along = travelled + length * fraction;
                let score = Math.abs(along - total / 2) / Math.max(total, 1) * 30 + (dx || dy ? 45 : 0);
                if (horizontal !== preferHorizontal) score += 30;
                const room = horizontal ? length - w : length - h;
                if (room < 0) score += Math.min(60, -room);
                if (along < 18 || total - along < 18) score += 80;
                for (const obstacle of obstacles) if (overlapArea(box, inflate(obstacle, 3)) > 0) score += 400;
                for (const chip of chips) if (overlapArea(box, chip) > 0) score += 300;
                for (const other of placed) if (overlapArea(box, inflate(other, 3)) > 0) score += 500;
                for (const segment of allSegments) {
                    if (segment.id === edge.id) continue;
                    if (segmentHitsBox(segment.a, segment.b, box)) score += 24;
                }
                if (!best || score < best.score - 0.001) best = { score, box };
            }
            travelled += length;
        }
        if (best) {
            const box = { x: Math.round(best.box.x * 2) / 2, y: Math.round(best.box.y * 2) / 2, w, h };
            placed.push(box);
            boxes.set(edge.id, box);
        }
    }
    return boxes;
}

export function routeEdges({ edges, endpoints, obstacles, groups, direction, manual }) {
    const routes = new Map();
    const searchable = [];
    for (const edge of edges) {
        const source = endpoints.get(edge.from);
        const target = endpoints.get(edge.to);
        if (!source || !target) continue;
        if (edge.from === edge.to) {
            routes.set(edge.id, selfLoop(source, direction));
        } else if (manual && edge.points?.length) {
            routes.set(edge.id, throughPoints(source, target, edge.points));
        } else {
            searchable.push(edge);
        }
    }
    if (searchable.length) {
        const first = routeAll({ edges: searchable, endpoints, obstacles, groups, direction, manual, fixed: null });
        const fixed = assignPorts(searchable, endpoints, first);
        const second = routeAll({ edges: searchable, endpoints, obstacles, groups, direction, manual, fixed });
        for (const edge of searchable) routes.set(edge.id, second.get(edge.id) ?? first.get(edge.id));
    }
    const ordered = new Map(edges.filter((edge) => routes.has(edge.id)).map((edge) => [edge.id, routes.get(edge.id)]));
    const searched = new Map([...ordered].filter(([id]) => searchable.some((edge) => edge.id === id)));
    centerSegments(searched, obstacles, groups, endpoints, edges);
    nudge(searched, obstacles);
    return ordered;
}
