export function boundsOf(boxes) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of boxes) {
        if (!box) continue;
        if (box.x < minX) minX = box.x;
        if (box.y < minY) minY = box.y;
        if (box.x + box.w > maxX) maxX = box.x + box.w;
        if (box.y + box.h > maxY) maxY = box.y + box.h;
    }
    return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function extremes(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const value of values) {
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return { min, max };
}

export function spatialIndex(initial, cell = 192) {
    const boxes = [...initial];
    const buckets = new Map();
    let stamps = new Uint32Array(Math.max(16, boxes.length));
    let stamp = 0;
    const range = (low, high) => [Math.floor(low / cell), Math.floor(high / cell)];
    const insert = (box, index) => {
        const [x0, x1] = range(box.x, box.x + box.w);
        const [y0, y1] = range(box.y, box.y + box.h);
        for (let cx = x0; cx <= x1; cx += 1) {
            for (let cy = y0; cy <= y1; cy += 1) {
                const key = `${cx},${cy}`;
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(index);
            }
        }
    };
    boxes.forEach(insert);
    return {
        add(box) {
            boxes.push(box);
            if (boxes.length > stamps.length) {
                const grown = new Uint32Array(stamps.length * 2);
                grown.set(stamps);
                stamps = grown;
            }
            insert(box, boxes.length - 1);
        },
        any(area, test) {
            stamp += 1;
            const [x0, x1] = range(area.x, area.x + area.w);
            const [y0, y1] = range(area.y, area.y + area.h);
            for (let cx = x0; cx <= x1; cx += 1) {
                for (let cy = y0; cy <= y1; cy += 1) {
                    const bucket = buckets.get(`${cx},${cy}`);
                    if (!bucket) continue;
                    for (const index of bucket) {
                        if (stamps[index] === stamp) continue;
                        stamps[index] = stamp;
                        if (test(boxes[index])) return true;
                    }
                }
            }
            return false;
        },
        each(area, visit) {
            this.any(area, (box) => {
                visit(box);
                return false;
            });
        }
    };
}

export function segmentArea(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
