const FACES = [
    { family: 'Geist', file: 'geist-sans.woff2' },
    { family: 'Geist Mono', file: 'geist-mono.woff2' }
];

let cached = null;
let pending = null;

function toBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
}

export function fontFaceCss(family, bytes) {
    return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${toBase64(bytes)}) format("woff2");font-weight:100 900;font-style:normal;}`;
}

export function exportFontCss() {
    return cached ?? '';
}

export function setExportFontCss(css) {
    cached = typeof css === 'string' ? css : null;
    pending = null;
}

async function fetchBinary(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`font ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

function inlineFaces(doc) {
    const faces = [];
    for (const style of doc?.querySelectorAll?.('style') ?? []) {
        for (const match of style.textContent.matchAll(/@font-face\s*\{[^}]*\}/g)) {
            if (/Geist/.test(match[0]) && /url\(\s*["']?data:/.test(match[0])) faces.push(match[0]);
        }
    }
    return faces.length ? faces.join('') : null;
}

export function loadExportFonts({ readBinary, doc = globalThis.document } = {}) {
    if (cached !== null) return Promise.resolve(cached);
    if (pending) return pending;
    const embedded = doc?.querySelector?.('style[data-dg-fonts]')?.textContent ?? inlineFaces(doc);
    if (embedded) {
        cached = embedded;
        return Promise.resolve(cached);
    }
    const read = readBinary ?? ((file) => fetchBinary(new URL(`../../../fonts/${file}`, import.meta.url)));
    pending = Promise.all(FACES.map(async (face) => fontFaceCss(face.family, await read(face.file))))
        .then((faces) => {
            cached = faces.join('');
            return cached;
        })
        .catch((error) => {
            console.error('diagram export: fonts could not be embedded', error);
            pending = null;
            return '';
        });
    return pending;
}
