const SWEEPS = 16;
const PLACEMENT_PASSES = 8;
const DUMMY_SIZE = 8;

function isHorizontal(direction) {
    return direction === 'LR' || direction === 'RL';
}

function breakCycles(ids, out, forcedBack) {
    const state = new Map();
    const reversed = new Set();
    const visit = (start) => {
        const stack = [[start, 0]];
        state.set(start, 1);
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const [node, index] = frame;
            const edges = out.get(node);
            if (index >= edges.length) {
                state.set(node, 2);
                stack.pop();
                continue;
            }
            frame[1] += 1;
            const edge = edges[index];
            if (forcedBack.has(edge.key)) continue;
            const next = edge.to;
            const mark = state.get(next) ?? 0;
            if (mark === 1) reversed.add(edge.key);
            else if (mark === 0) {
                state.set(next, 1);
                stack.push([next, 0]);
            }
        }
    };
    for (const id of ids) if (!state.has(id)) visit(id);
    for (const key of forcedBack) reversed.add(key);
    return reversed;
}

function topoOrder(ids, preds) {
    const remaining = new Map(ids.map((id) => [id, preds.get(id).length]));
    const succ = new Map(ids.map((id) => [id, []]));
    for (const id of ids) for (const p of preds.get(id)) succ.get(p).push(id);
    const queue = ids.filter((id) => remaining.get(id) === 0);
    const order = [];
    for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index];
        order.push(id);
        for (const next of succ.get(id)) {
            remaining.set(next, remaining.get(next) - 1);
            if (remaining.get(next) === 0) queue.push(next);
        }
    }
    return order;
}

function assignRanks(ids, dag, laneOf, laneCount) {
    const preds = new Map(ids.map((id) => [id, []]));
    const succs = new Map(ids.map((id) => [id, []]));
    for (const edge of dag) {
        preds.get(edge.to).push(edge.from);
        succs.get(edge.from).push(edge.to);
    }
    const order = topoOrder(ids, preds);
    const rank = new Map();
    if (laneCount) {
        let base = 0;
        for (let lane = 0; lane < laneCount; lane += 1) {
            const members = order.filter((id) => laneOf.get(id) === lane);
            let top = base - 1;
            for (const id of members) {
                let value = base;
                for (const p of preds.get(id)) if (rank.has(p)) value = Math.max(value, rank.get(p) + 1);
                rank.set(id, value);
                top = Math.max(top, value);
            }
            for (const id of [...members].reverse()) {
                if (preds.get(id).length) continue;
                const targets = succs.get(id).filter((s) => laneOf.get(s) === lane);
                if (!targets.length || succs.get(id).length !== targets.length) continue;
                const value = Math.min(...targets.map((s) => rank.get(s))) - 1;
                if (value > rank.get(id)) rank.set(id, value);
            }
            base = top + 1;
        }
        return rank;
    }
    for (const id of order) {
        let value = 0;
        for (const p of preds.get(id)) value = Math.max(value, rank.get(p) + 1);
        rank.set(id, value);
    }
    for (const id of [...order].reverse()) {
        if (preds.get(id).length || !succs.get(id).length) continue;
        const value = Math.min(...succs.get(id).map((s) => rank.get(s))) - 1;
        if (value > rank.get(id)) rank.set(id, value);
    }
    return rank;
}

function countCrossings(upper, lower, links) {
    const pos = new Map();
    upper.forEach((id, index) => pos.set(id, index));
    const lowerPos = new Map();
    lower.forEach((id, index) => lowerPos.set(id, index));
    const pairs = [];
    for (const id of upper) {
        for (const target of links.get(id) ?? []) {
            if (lowerPos.has(target)) pairs.push([pos.get(id), lowerPos.get(target)]);
        }
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let crossings = 0;
    for (let i = 0; i < pairs.length; i += 1) {
        for (let j = i + 1; j < pairs.length; j += 1) {
            if (pairs[j][0] > pairs[i][0] && pairs[j][1] < pairs[i][1]) crossings += 1;
        }
    }
    return crossings;
}

function totalCrossings(layers, down) {
    let total = 0;
    for (let r = 0; r + 1 < layers.length; r += 1) total += countCrossings(layers[r], layers[r + 1], down);
    return total;
}

function barycenterSweep(layers, neighbours, fromAbove, laneKey) {
    const range = fromAbove ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(1);
    for (const r of range) {
        const reference = layers[fromAbove ? r - 1 : r + 1];
        const pos = new Map(reference.map((id, index) => [id, index]));
        const layer = layers[r];
        const keyed = layer.map((id, index) => {
            const linked = (neighbours.get(id) ?? []).filter((n) => pos.has(n));
            const value = linked.length ? linked.reduce((sum, n) => sum + pos.get(n), 0) / linked.length : index * (reference.length / Math.max(1, layer.length));
            return { id, value, index };
        });
        keyed.sort((a, b) => (laneKey(a.id) - laneKey(b.id)) || (a.value - b.value) || (a.index - b.index));
        layers[r] = keyed.map((entry) => entry.id);
    }
}

function transpose(layers, down, up, laneKey) {
    let improved = true;
    let guard = 0;
    while (improved && guard < 8) {
        improved = false;
        guard += 1;
        for (let r = 0; r < layers.length; r += 1) {
            const layer = layers[r];
            for (let i = 0; i + 1 < layer.length; i += 1) {
                const a = layer[i];
                const b = layer[i + 1];
                if (laneKey(a) !== laneKey(b)) continue;
                const before = pairCrossings(a, b, layers, r, down, up);
                const after = pairCrossings(b, a, layers, r, down, up);
                if (after < before) {
                    layer[i] = b;
                    layer[i + 1] = a;
                    improved = true;
                }
            }
        }
    }
}

function pairCrossings(a, b, layers, r, down, up) {
    let crossings = 0;
    for (const [links, other] of [[up, layers[r - 1]], [down, layers[r + 1]]]) {
        if (!other) continue;
        const pos = new Map(other.map((id, index) => [id, index]));
        const pa = (links.get(a) ?? []).filter((n) => pos.has(n)).map((n) => pos.get(n));
        const pb = (links.get(b) ?? []).filter((n) => pos.has(n)).map((n) => pos.get(n));
        for (const x of pa) for (const y of pb) if (x > y) crossings += 1;
    }
    return crossings;
}

function isotonic(targets, weights) {
    const blocks = [];
    targets.forEach((target, index) => {
        blocks.push({ sum: target * weights[index], weight: weights[index], count: 1 });
        while (blocks.length > 1) {
            const last = blocks[blocks.length - 1];
            const prev = blocks[blocks.length - 2];
            if (prev.sum / prev.weight <= last.sum / last.weight) break;
            prev.sum += last.sum;
            prev.weight += last.weight;
            prev.count += last.count;
            blocks.pop();
        }
    });
    const result = [];
    for (const block of blocks) for (let i = 0; i < block.count; i += 1) result.push(block.sum / block.weight);
    return result;
}

export function layered({ items, edges, direction = 'LR', spacing, lanes = null }) {
    const horizontal = isHorizontal(direction);
    const crossOf = (item) => (horizontal ? item.h : item.w);
    const mainOf = (item) => (horizontal ? item.w : item.h);
    const ids = items.map((item) => item.id);
    const byId = new Map(items.map((item) => [item.id, item]));
    const bandLanes = lanes && horizontal ? lanes : null;
    const columnLanes = lanes && !horizontal ? lanes : null;
    const laneOf = new Map(items.map((item) => [item.id, item.lane ?? 0]));

    const links = edges.filter((edge) => edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to))
        .map((edge, index) => ({ ...edge, key: index }));
    const out = new Map(ids.map((id) => [id, []]));
    for (const edge of links) out.get(edge.from).push(edge);
    const forcedBack = new Set(bandLanes ? links.filter((edge) => laneOf.get(edge.from) > laneOf.get(edge.to)).map((edge) => edge.key) : []);
    const reversed = breakCycles(ids, out, forcedBack);
    const dag = links.map((edge) => (reversed.has(edge.key) ? { ...edge, from: edge.to, to: edge.from, reversed: true } : edge));

    const rank = assignRanks(ids, dag, laneOf, bandLanes ? bandLanes.count : 0);
    const minRank = Math.min(0, ...rank.values());
    for (const id of ids) rank.set(id, rank.get(id) - minRank);
    const rankCount = ids.length ? Math.max(...rank.values()) + 1 : 0;

    const nodes = new Map(items.map((item) => [item.id, { id: item.id, real: true, cross: crossOf(item), main: mainOf(item), rank: rank.get(item.id) }]));
    const down = new Map();
    const up = new Map();
    const weightOf = new Map();
    const link = (a, b, weight) => {
        if (!down.has(a)) down.set(a, []);
        if (!up.has(b)) up.set(b, []);
        down.get(a).push(b);
        up.get(b).push(a);
        weightOf.set(`${a}>${b}`, Math.max(weightOf.get(`${a}>${b}`) ?? 0, weight));
    };
    const gapLabels = new Map();
    const gapEdges = new Map();
    dag.forEach((edge) => {
        const span = rank.get(edge.to) - rank.get(edge.from);
        if (span <= 0) return;
        const labelGap = rank.get(edge.from);
        if (edge.label) {
            const size = horizontal ? edge.label.w : edge.label.h;
            gapLabels.set(labelGap, Math.max(gapLabels.get(labelGap) ?? 0, size));
        }
        for (let r = rank.get(edge.from); r < rank.get(edge.to); r += 1) gapEdges.set(r, (gapEdges.get(r) ?? 0) + 1);
        let previous = edge.from;
        for (let r = rank.get(edge.from) + 1; r < rank.get(edge.to); r += 1) {
            const id = `\u0000${edge.key}:${r}`;
            nodes.set(id, { id, real: false, cross: DUMMY_SIZE, main: 0, rank: r });
            laneOf.set(id, laneOf.get(edge.from));
            link(previous, id, previous === edge.from ? 2 : 8);
            previous = id;
        }
        link(previous, edge.to, previous === edge.from ? 1 : 2);
    });

    const discovery = new Map();
    const discover = (id) => {
        if (discovery.has(id)) return;
        discovery.set(id, discovery.size);
        for (const next of down.get(id) ?? []) discover(next);
    };
    const all = [...nodes.keys()];
    for (const id of ids) if (!(up.get(id) ?? []).length) discover(id);
    for (const id of all) discover(id);

    const layers = Array.from({ length: rankCount }, () => []);
    for (const id of all) layers[nodes.get(id).rank].push(id);
    const laneKey = columnLanes ? (id) => laneOf.get(id) : () => 0;
    for (const layer of layers) layer.sort((a, b) => (laneKey(a) - laneKey(b)) || (discovery.get(a) - discovery.get(b)));

    let best = layers.map((layer) => [...layer]);
    let bestCrossings = totalCrossings(layers, down);
    for (let sweep = 0; sweep < SWEEPS && bestCrossings > 0; sweep += 1) {
        barycenterSweep(layers, sweep % 2 === 0 ? up : down, sweep % 2 === 0, laneKey);
        transpose(layers, down, up, laneKey);
        const crossings = totalCrossings(layers, down);
        if (crossings < bestCrossings) {
            bestCrossings = crossings;
            best = layers.map((layer) => [...layer]);
        }
    }

    const center = new Map();
    const separation = (a, b) => {
        const na = nodes.get(a);
        const nb = nodes.get(b);
        let gap = spacing.node;
        if (!na.real && !nb.real) gap = 6;
        else if (!na.real || !nb.real) gap = Math.max(10, spacing.node / 2);
        if (columnLanes && laneOf.get(a) !== laneOf.get(b)) gap += columnLanes.pad * 2 + columnLanes.gap;
        return (na.cross + nb.cross) / 2 + gap;
    };
    for (const layer of best) {
        let cursor = 0;
        layer.forEach((id, index) => {
            if (index) cursor += separation(layer[index - 1], id);
            center.set(id, cursor);
        });
    }
    const weight = (a, b) => weightOf.get(`${a}>${b}`) ?? weightOf.get(`${b}>${a}`) ?? 1;
    const place = (layer, neighbourMaps) => {
        const desired = layer.map((id) => {
            let sum = 0;
            let total = 0;
            for (const map of neighbourMaps) {
                for (const n of map.get(id) ?? []) {
                    const w = weight(id, n);
                    sum += center.get(n) * w;
                    total += w;
                }
            }
            return total ? sum / total : center.get(id);
        });
        const offsets = [0];
        for (let i = 1; i < layer.length; i += 1) offsets.push(offsets[i - 1] + separation(layer[i - 1], layer[i]));
        const fitted = isotonic(desired.map((value, index) => value - offsets[index]), layer.map((id) => (nodes.get(id).real ? 1 : 2)));
        layer.forEach((id, index) => center.set(id, fitted[index] + offsets[index]));
    };
    for (let pass = 0; pass < PLACEMENT_PASSES; pass += 1) {
        if (pass % 2 === 0) for (let r = 1; r < best.length; r += 1) place(best[r], [up]);
        else for (let r = best.length - 2; r >= 0; r -= 1) place(best[r], [down]);
    }
    for (let pass = 0; pass < 2; pass += 1) {
        for (let r = 0; r < best.length; r += 1) place(best[r], [up, down]);
    }

    const thickness = best.map((layer) => Math.max(0, ...layer.map((id) => nodes.get(id).main)));
    const gapAfter = (r) => {
        const label = gapLabels.get(r) ?? 0;
        const channels = Math.min(gapEdges.get(r) ?? 0, 10);
        let gap = Math.max(spacing.rank, label ? label + (horizontal ? 36 : 28) : 0, channels * 8 + 24);
        if (bandLanes && rankLane(r) !== rankLane(r + 1)) gap = Math.max(gap, bandLanes.pad * 2 + bandLanes.gap);
        return gap;
    };
    function rankLane(r) {
        const layer = best[r] ?? [];
        const realId = layer.find((id) => nodes.get(id).real) ?? layer[0];
        return realId === undefined ? -1 : laneOf.get(realId);
    }

    const rankStart = [];
    const laneBands = [];
    if (bandLanes) {
        let cursor = 0;
        let previousEnd = null;
        let previousRank = -1;
        for (let lane = 0; lane < bandLanes.count; lane += 1) {
            const laneRanks = [];
            for (let r = 0; r < best.length; r += 1) if (rankLane(r) === lane) laneRanks.push(r);
            let start = cursor + bandLanes.pad;
            if (previousRank >= 0 && laneRanks.length) start = Math.max(start, previousEnd + gapAfter(previousRank));
            let position = start;
            laneRanks.forEach((r, index) => {
                if (index) position += gapAfter(laneRanks[index - 1]);
                rankStart[r] = position;
                position += thickness[r];
            });
            const contentEnd = laneRanks.length ? position : start;
            const laneStart = start - bandLanes.pad;
            const minWidth = bandLanes.minWidths[lane] ?? 0;
            const natural = contentEnd + bandLanes.pad - laneStart;
            const width = Math.max(natural, minWidth);
            const shift = (width - natural) / 2;
            laneRanks.forEach((r) => { rankStart[r] += shift; });
            laneBands.push({ start: laneStart, end: laneStart + width });
            if (laneRanks.length) {
                previousEnd = contentEnd + shift;
                previousRank = laneRanks[laneRanks.length - 1];
            }
            cursor = laneStart + width + bandLanes.gap;
        }
        for (let lane = 1; lane < laneBands.length; lane += 1) {
            const prev = laneBands[lane - 1];
            const next = laneBands[lane];
            if (next.start - prev.end > bandLanes.gap) prev.end = next.start - bandLanes.gap;
        }
    } else {
        let position = 0;
        for (let r = 0; r < best.length; r += 1) {
            rankStart[r] = position;
            position += thickness[r] + (r + 1 < best.length ? gapAfter(r) : 0);
        }
    }

    if (columnLanes) {
        let cursor = 0;
        for (let lane = 0; lane < columnLanes.count; lane += 1) {
            const members = all.filter((id) => laneOf.get(id) === lane);
            const low = members.length ? Math.min(...members.map((id) => center.get(id) - nodes.get(id).cross / 2)) : 0;
            const high = members.length ? Math.max(...members.map((id) => center.get(id) + nodes.get(id).cross / 2)) : 0;
            const natural = (high - low) + columnLanes.pad * 2;
            const width = Math.max(natural, columnLanes.minWidths[lane] ?? 0);
            const offset = cursor + columnLanes.pad + (width - natural) / 2 - low;
            for (const id of members) center.set(id, center.get(id) + offset);
            laneBands.push({ start: cursor, end: cursor + width });
            cursor += width + columnLanes.gap;
        }
    } else {
        const shift = all.length ? -Math.min(...all.map((id) => center.get(id) - nodes.get(id).cross / 2)) : 0;
        for (const id of all) center.set(id, center.get(id) + shift);
    }

    const crossExtent = Math.max(0, ...all.map((id) => center.get(id) + nodes.get(id).cross / 2), ...laneBands.map((band) => (columnLanes ? band.end : 0)));
    const mainExtent = bandLanes && laneBands.length
        ? laneBands[laneBands.length - 1].end
        : (best.length ? rankStart[best.length - 1] + thickness[best.length - 1] : 0);

    const positions = new Map();
    for (const id of ids) {
        const node = nodes.get(id);
        const main = rankStart[node.rank] + (thickness[node.rank] - node.main) / 2;
        const cross = center.get(id) - node.cross / 2;
        positions.set(id, horizontal ? { x: main, y: cross } : { x: cross, y: main });
    }
    const width = horizontal ? mainExtent : crossExtent;
    const height = horizontal ? crossExtent : mainExtent;

    if (direction === 'RL' || direction === 'BT') {
        for (const [id, position] of positions) {
            const item = byId.get(id);
            if (direction === 'RL') position.x = width - position.x - item.w;
            else position.y = height - position.y - item.h;
        }
        if (direction === 'RL') {
            for (const band of laneBands) {
                const start = width - band.end;
                band.end = width - band.start;
                band.start = start;
            }
        }
    }

    return { positions, width, height, laneBands, ranks: rank, reversed };
}
