const SWEEPS = 16;
const PLACEMENT_PASSES = 8;
const DUMMY_SIZE = 10;
const ORDER_BUDGET = 3000000;
const MAX_DUMMIES = 60000;
const LARGE_GRAPH = 40000;

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
    balanceRanks(order, preds, succs, rank);
    return rank;
}

function balanceRanks(order, preds, succs, rank) {
    for (let pass = 0; pass < 8; pass += 1) {
        let moved = false;
        const sequence = pass % 2 === 0 ? order : [...order].reverse();
        for (const id of sequence) {
            const before = preds.get(id);
            const after = succs.get(id);
            if (!before.length && !after.length) continue;
            const low = before.length ? Math.max(...before.map((p) => rank.get(p))) + 1 : -Infinity;
            const high = after.length ? Math.min(...after.map((s) => rank.get(s))) - 1 : Infinity;
            if (low > high) continue;
            const wishes = [...before.map((p) => rank.get(p) + 1), ...after.map((s) => rank.get(s) - 1)].sort((a, b) => a - b);
            const middle = wishes.length % 2
                ? wishes[(wishes.length - 1) / 2]
                : Math.round((wishes[wishes.length / 2 - 1] + wishes[wishes.length / 2]) / 2 - 0.01);
            const target = Math.min(high, Math.max(low, middle));
            if (target !== rank.get(id)) {
                rank.set(id, target);
                moved = true;
            }
        }
        if (!moved) break;
    }
}

function crossingsBetween(upper, lower, downIdx, pos) {
    if (!upper.length || !lower.length) return 0;
    let first = 1;
    while (first < lower.length) first *= 2;
    const tree = new Int32Array(first * 2 - 1);
    const base = first - 1;
    let crossings = 0;
    const targets = [];
    for (const node of upper) {
        targets.length = 0;
        for (const next of downIdx[node]) targets.push(pos[next]);
        targets.sort((a, b) => a - b);
        for (const target of targets) {
            let index = target + base;
            tree[index] += 1;
            while (index > 0) {
                if (index % 2) crossings += tree[index + 1];
                index = (index - 1) >> 1;
                tree[index] += 1;
            }
        }
    }
    return crossings;
}

function pairCount(a, b) {
    let crossings = 0;
    let j = 0;
    for (const x of a) {
        while (j < b.length && b[j] < x) j += 1;
        crossings += j;
    }
    return crossings;
}

function minimizeCrossings(layers, graph, budget) {
    const { downIdx, upIdx, lane, pos } = graph;
    const layerCount = layers.length;
    const edgeCount = downIdx.reduce((sum, list) => sum + list.length, 0);
    let work = 0;
    const setPositions = (layer) => {
        for (let i = 0; i < layer.length; i += 1) pos[layer[i]] = i;
    };
    const total = () => {
        work += edgeCount + layerCount;
        let sum = 0;
        for (let r = 0; r + 1 < layerCount; r += 1) sum += crossingsBetween(layers[r], layers[r + 1], downIdx, pos);
        return sum;
    };
    const sweep = (fromAbove) => {
        const order = [];
        for (let r = 1; r < layerCount; r += 1) order.push(fromAbove ? r : layerCount - 1 - r);
        for (const r of order) {
            const reference = layers[fromAbove ? r - 1 : r + 1].length;
            const layer = layers[r];
            const links = fromAbove ? upIdx : downIdx;
            const keyed = layer.map((node, index) => {
                const list = links[node];
                let value = index * (reference / Math.max(1, layer.length));
                if (list.length) {
                    let sum = 0;
                    for (const other of list) sum += pos[other];
                    value = sum / list.length;
                }
                work += list.length + 1;
                return { node, value, index };
            });
            keyed.sort((a, b) => (lane[a.node] - lane[b.node]) || (a.value - b.value) || (a.index - b.index));
            for (let i = 0; i < keyed.length; i += 1) layer[i] = keyed[i].node;
            setPositions(layer);
        }
    };
    const transpose = () => {
        let improved = true;
        let rounds = 0;
        while (improved && rounds < 8 && work < budget) {
            improved = false;
            rounds += 1;
            for (let r = 0; r < layerCount; r += 1) {
                const layer = layers[r];
                if (layer.length < 2) continue;
                const neighbours = (links) => layer.map((node) => {
                    const values = links[node].map((other) => pos[other]);
                    values.sort((a, b) => a - b);
                    return values;
                });
                const above = r > 0 ? neighbours(upIdx) : null;
                const below = r + 1 < layerCount ? neighbours(downIdx) : null;
                for (let i = 0; i + 1 < layer.length; i += 1) {
                    const a = layer[i];
                    const b = layer[i + 1];
                    if (lane[a] !== lane[b]) continue;
                    let before = 0;
                    let after = 0;
                    if (above) {
                        before += pairCount(above[i], above[i + 1]);
                        after += pairCount(above[i + 1], above[i]);
                        work += above[i].length + above[i + 1].length;
                    }
                    if (below) {
                        before += pairCount(below[i], below[i + 1]);
                        after += pairCount(below[i + 1], below[i]);
                        work += below[i].length + below[i + 1].length;
                    }
                    work += 1;
                    if (after < before) {
                        layer[i] = b;
                        layer[i + 1] = a;
                        pos[a] = i + 1;
                        pos[b] = i;
                        if (above) [above[i], above[i + 1]] = [above[i + 1], above[i]];
                        if (below) [below[i], below[i + 1]] = [below[i + 1], below[i]];
                        improved = true;
                    }
                }
            }
        }
    };

    layers.forEach(setPositions);
    let best = layers.map((layer) => layer.slice());
    let bestCrossings = total();
    for (let round = 0; round < SWEEPS && bestCrossings > 0 && work < budget; round += 1) {
        sweep(round % 2 === 0);
        transpose();
        const crossings = total();
        if (crossings < bestCrossings) {
            bestCrossings = crossings;
            best = layers.map((layer) => layer.slice());
        }
    }
    return best;
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

    const realCount = ids.length;
    const index = new Map(ids.map((id, position) => [id, position]));
    const crossList = items.map((item) => crossOf(item));
    const mainList = items.map((item) => mainOf(item));
    const rankList = ids.map((id) => rank.get(id));
    const laneList = ids.map((id) => laneOf.get(id) ?? 0);
    const downList = ids.map(() => []);
    const upList = ids.map(() => []);
    const downWeightList = ids.map(() => []);
    const upWeightList = ids.map(() => []);
    const pairWeight = new Map();
    const link = (a, b, weight) => {
        downList[a].push(b);
        upList[b].push(a);
        downWeightList[a].push(weight);
        upWeightList[b].push(weight);
        if (a < realCount && b < realCount) {
            const key = a * 4194304 + b;
            pairWeight.set(key, Math.max(pairWeight.get(key) ?? 0, weight));
        }
    };
    const gapLabels = new Map();
    const gapEdges = new Map();
    const chains = new Map();
    const spanOf = (edge) => rankList[index.get(edge.to)] - rankList[index.get(edge.from)];
    const kept = new Set();
    let dummyBudget = MAX_DUMMIES;
    for (const edge of [...dag].sort((a, b) => spanOf(a) - spanOf(b) || a.key - b.key)) {
        const extra = Math.max(0, spanOf(edge) - 1);
        if (extra > dummyBudget) continue;
        dummyBudget -= extra;
        kept.add(edge.key);
    }
    dag.forEach((edge) => {
        if (!kept.has(edge.key)) return;
        const from = index.get(edge.from);
        const to = index.get(edge.to);
        const span = rankList[to] - rankList[from];
        if (span <= 0) return;
        const labelGap = rankList[from];
        if (edge.label) {
            const size = horizontal ? edge.label.w : edge.label.h;
            gapLabels.set(labelGap, Math.max(gapLabels.get(labelGap) ?? 0, size));
        }
        for (let r = rankList[from]; r < rankList[to]; r += 1) gapEdges.set(r, (gapEdges.get(r) ?? 0) + 1);
        let previous = from;
        const chain = [];
        chains.set(edge.key, { edge, chain });
        const slot = edge.label ? (horizontal ? edge.label.h : edge.label.w) + 6 : DUMMY_SIZE;
        for (let r = rankList[from] + 1; r < rankList[to]; r += 1) {
            const dummy = crossList.length;
            chain.push(dummy);
            crossList.push(slot);
            mainList.push(0);
            rankList.push(r);
            laneList.push(laneList[from]);
            downList.push([]);
            upList.push([]);
            downWeightList.push([]);
            upWeightList.push([]);
            link(previous, dummy, previous === from ? 2 : 8);
            previous = dummy;
        }
        link(previous, to, previous === from ? 1 : 2);
    });
    if (pairWeight.size) {
        for (let a = 0; a < realCount; a += 1) {
            const list = downList[a];
            for (let i = 0; i < list.length; i += 1) {
                if (list[i] >= realCount) continue;
                const weight = pairWeight.get(a * 4194304 + list[i]);
                downWeightList[a][i] = weight;
            }
        }
        for (let b = 0; b < realCount; b += 1) {
            const list = upList[b];
            for (let i = 0; i < list.length; i += 1) {
                if (list[i] >= realCount) continue;
                upWeightList[b][i] = pairWeight.get(list[i] * 4194304 + b);
            }
        }
    }

    const count = crossList.length;
    const crossSize = Float64Array.from(crossList);
    const mainSize = Float64Array.from(mainList);
    const isReal = new Uint8Array(count);
    isReal.fill(1, 0, realCount);
    const laneIdx = Int32Array.from(laneList);
    const rankIdx = Int32Array.from(rankList);
    const downIdx = downList;
    const upIdx = upList;
    const downWeight = downWeightList;
    const upWeight = upWeightList;

    const discovery = new Int32Array(count).fill(-1);
    let discovered = 0;
    const discover = (startNode) => {
        if (discovery[startNode] >= 0) return;
        const stack = [startNode];
        while (stack.length) {
            const node = stack.pop();
            if (discovery[node] >= 0) continue;
            discovery[node] = discovered;
            discovered += 1;
            const next = downIdx[node];
            for (let i = next.length - 1; i >= 0; i -= 1) if (discovery[next[i]] < 0) stack.push(next[i]);
        }
    };
    for (let node = 0; node < realCount; node += 1) if (!upIdx[node].length) discover(node);
    for (let node = 0; node < count; node += 1) discover(node);

    const layers = Array.from({ length: rankCount }, () => []);
    for (let node = 0; node < count; node += 1) layers[rankIdx[node]].push(node);
    const laneKey = columnLanes ? laneIdx : new Int32Array(count);
    for (const layer of layers) layer.sort((a, b) => (laneKey[a] - laneKey[b]) || (discovery[a] - discovery[b]));

    const best = minimizeCrossings(layers, { downIdx, upIdx, lane: laneKey, pos: new Int32Array(count) }, ORDER_BUDGET);

    const center = new Float64Array(count);
    const separation = (a, b) => {
        let gap = spacing.node;
        if (!isReal[a] && !isReal[b]) gap = 8;
        else if (!isReal[a] || !isReal[b]) gap = Math.max(14, spacing.node * 0.6);
        if (columnLanes && laneIdx[a] !== laneIdx[b]) gap += columnLanes.pad * 2 + columnLanes.gap;
        return (crossSize[a] + crossSize[b]) / 2 + gap;
    };
    for (const layer of best) {
        let cursor = 0;
        layer.forEach((node, position) => {
            if (position) cursor += separation(layer[position - 1], node);
            center[node] = cursor;
        });
    }
    const place = (layer, useUp, useDown) => {
        const desired = new Float64Array(layer.length);
        const weights = new Float64Array(layer.length);
        const offsets = new Float64Array(layer.length);
        layer.forEach((node, position) => {
            let sum = 0;
            let total = 0;
            if (useUp) {
                const list = upIdx[node];
                const w = upWeight[node];
                for (let i = 0; i < list.length; i += 1) {
                    sum += center[list[i]] * w[i];
                    total += w[i];
                }
            }
            if (useDown) {
                const list = downIdx[node];
                const w = downWeight[node];
                for (let i = 0; i < list.length; i += 1) {
                    sum += center[list[i]] * w[i];
                    total += w[i];
                }
            }
            if (position) offsets[position] = offsets[position - 1] + separation(layer[position - 1], node);
            desired[position] = (total ? sum / total : center[node]) - offsets[position];
            weights[position] = isReal[node] ? 1 : 2;
        });
        const fitted = isotonic(desired, weights);
        layer.forEach((node, position) => { center[node] = fitted[position] + offsets[position]; });
    };
    const passes = count > LARGE_GRAPH ? 4 : PLACEMENT_PASSES;
    for (let pass = 0; pass < passes; pass += 1) {
        if (pass % 2 === 0) for (let r = 1; r < best.length; r += 1) place(best[r], true, false);
        else for (let r = best.length - 2; r >= 0; r -= 1) place(best[r], false, true);
    }
    for (let pass = 0; pass < 2; pass += 1) {
        for (let r = 0; r < best.length; r += 1) place(best[r], true, true);
    }

    const thickness = best.map((layer) => {
        let value = 0;
        for (const node of layer) value = Math.max(value, mainSize[node]);
        return value;
    });
    const gapAfter = (r) => {
        const label = gapLabels.get(r) ?? 0;
        const channels = Math.min(gapEdges.get(r) ?? 0, 10);
        let gap = Math.max(spacing.rank, label ? label + (horizontal ? 36 : 28) : 0, channels * 8 + 24);
        if (bandLanes && rankLane(r) !== rankLane(r + 1)) gap = Math.max(gap, bandLanes.pad * 2 + bandLanes.gap);
        return gap;
    };
    function rankLane(r) {
        const layer = best[r] ?? [];
        const real = layer.find((node) => isReal[node]) ?? layer[0];
        return real === undefined ? -1 : laneIdx[real];
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
            let low = Infinity;
            let high = -Infinity;
            const members = [];
            for (let node = 0; node < count; node += 1) {
                if (laneIdx[node] !== lane) continue;
                members.push(node);
                low = Math.min(low, center[node] - crossSize[node] / 2);
                high = Math.max(high, center[node] + crossSize[node] / 2);
            }
            if (!members.length) {
                low = 0;
                high = 0;
            }
            const natural = (high - low) + columnLanes.pad * 2;
            const width = Math.max(natural, columnLanes.minWidths[lane] ?? 0);
            const offset = cursor + columnLanes.pad + (width - natural) / 2 - low;
            for (const node of members) center[node] += offset;
            laneBands.push({ start: cursor, end: cursor + width });
            cursor += width + columnLanes.gap;
        }
    } else {
        let low = Infinity;
        for (let node = 0; node < count; node += 1) low = Math.min(low, center[node] - crossSize[node] / 2);
        const shift = count ? -low : 0;
        for (let node = 0; node < count; node += 1) center[node] += shift;
    }

    let crossExtent = 0;
    for (let node = 0; node < count; node += 1) crossExtent = Math.max(crossExtent, center[node] + crossSize[node] / 2);
    if (columnLanes) for (const band of laneBands) crossExtent = Math.max(crossExtent, band.end);
    const mainExtent = bandLanes && laneBands.length
        ? laneBands[laneBands.length - 1].end
        : (best.length ? rankStart[best.length - 1] + thickness[best.length - 1] : 0);

    const positions = new Map();
    for (const id of ids) {
        const node = index.get(id);
        const main = rankStart[rankIdx[node]] + (thickness[rankIdx[node]] - mainSize[node]) / 2;
        const cross = center[node] - crossSize[node] / 2;
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

    const toPoint = (main, cross) => {
        let x = horizontal ? main : cross;
        let y = horizontal ? cross : main;
        if (direction === 'RL') x = width - x;
        if (direction === 'BT') y = height - y;
        return { x, y };
    };
    const rankBands = best.map((layer, r) => {
        const a = toPoint(rankStart[r], 0);
        const b = toPoint(rankStart[r] + thickness[r], 0);
        const [start, end] = horizontal ? [a.x, b.x] : [a.y, b.y];
        return { start: Math.min(start, end), end: Math.max(start, end) };
    });
    const paths = new Map();
    for (const { edge, chain } of chains.values()) {
        const fromRank = rank.get(edge.from);
        const toRank = rank.get(edge.to);
        const via = chain.map((node) => toPoint(rankStart[rankIdx[node]] + thickness[rankIdx[node]] / 2, center[node]));
        const gaps = [];
        for (let r = fromRank; r < toRank; r += 1) {
            const a = rankBands[r];
            const b = rankBands[r + 1];
            gaps.push((Math.max(a.start, b.start) + Math.min(a.end, b.end)) / 2);
        }
        paths.set(edge.id, { reversed: Boolean(edge.reversed), via, gaps });
    }

    return { positions, width, height, laneBands, ranks: rank, reversed, paths, rankBands };
}
