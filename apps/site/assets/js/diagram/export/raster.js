export const RASTER_LIMITS = {
    maxSide: 16384,
    maxArea: 16777216
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function fitScale(width, height, scale = 2, limits = RASTER_LIMITS) {
    if (!(width > 0) || !(height > 0)) throw new TypeError('The image needs a positive width and height');
    let factor = Math.max(Number(scale) || 1, 0.01);
    factor = Math.min(factor, limits.maxSide / width, limits.maxSide / height);
    if (width * height * factor * factor > limits.maxArea) factor = Math.sqrt(limits.maxArea / (width * height));
    const pixelWidth = Math.max(1, Math.floor(width * factor));
    const pixelHeight = Math.max(1, Math.floor(height * factor));
    return { factor, width: pixelWidth, height: pixelHeight };
}

function readSize(root, width, height) {
    const viewBox = String(root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const fromViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) ? { width: viewBox[2], height: viewBox[3] } : null;
    const attribute = (name) => {
        const value = parseFloat(root.getAttribute(name) ?? '');
        return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    return {
        width: Number(width) || attribute('width') || fromViewBox?.width || 0,
        height: Number(height) || attribute('height') || fromViewBox?.height || 0,
        hasViewBox: Boolean(fromViewBox)
    };
}

function prepareSvg(svg, width, height) {
    let root;
    if (typeof svg === 'string') {
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
        root = document.documentElement;
        if (!root || root.nodeName.toLowerCase() !== 'svg' || document.getElementsByTagName('parsererror').length) {
            throw new TypeError('The markup is not a valid SVG document');
        }
    } else if (svg && typeof svg.cloneNode === 'function') {
        root = svg.cloneNode(true);
    } else {
        throw new TypeError('Expected SVG markup or an SVG element');
    }
    const size = readSize(root, width, height);
    if (!(size.width > 0) || !(size.height > 0)) throw new TypeError('The SVG has no measurable size');
    if (!size.hasViewBox) root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
    return { root, size };
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The SVG could not be decoded'));
        image.src = url;
    });
}

export async function svgToRaster(svg, { width, height, scale = 2, type = 'image/png', background, quality = 0.92 } = {}) {
    const { root, size } = prepareSvg(svg, width, height);
    const target = fitScale(size.width, size.height, scale);
    root.setAttribute('width', String(target.width));
    root.setAttribute('height', String(target.height));
    const markup = new XMLSerializer().serializeToString(root);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    try {
        const image = await loadImage(url);
        if (typeof image.decode === 'function') await image.decode().catch(() => {});
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('A 2D canvas is not available');
        const fill = background ?? (type === 'image/jpeg' ? '#ffffff' : undefined);
        if (fill) {
            context.fillStyle = fill;
            context.fillRect(0, 0, target.width, target.height);
        }
        context.drawImage(image, 0, 0, target.width, target.height);
        return await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The canvas could not be exported'))), type, quality);
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}
