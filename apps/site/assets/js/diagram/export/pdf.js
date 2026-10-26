export const PDF_LIMITS = {
    pointsPerUnit: 0.75,
    maxPagePoints: 14400,
    minPagePoints: 36,
    maxTexts: 20000
};

const WIN_ANSI_EXTRA = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

const HELVETICA_ASCII = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const HELVETICA_EXTRA = {
    0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000,
    0xa0: 278, 0xa1: 333, 0xa9: 737, 0xab: 556, 0xae: 737, 0xb0: 400, 0xb7: 278, 0xbb: 556, 0xbf: 611, 0xd7: 584,
    0xdf: 611, 0xe6: 889, 0xc6: 1000, 0xf7: 584
};

const encoder = new TextEncoder();

function ascii(text) {
    return encoder.encode(text);
}

export function toWinAnsi(text) {
    const bytes = [];
    for (const char of String(text ?? '')) {
        const code = char.codePointAt(0);
        if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
            bytes.push(code);
            continue;
        }
        if (WIN_ANSI_EXTRA[code] !== undefined) {
            bytes.push(WIN_ANSI_EXTRA[code]);
            continue;
        }
        if (code === 0x09 || code === 0x0a || code === 0x0d) {
            bytes.push(0x20);
            continue;
        }
        const base = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const fallback = base.length === 1 ? base.codePointAt(0) : 0;
        bytes.push((fallback >= 0x20 && fallback <= 0x7e) || (fallback >= 0xa0 && fallback <= 0xff) ? fallback : 0x3f);
    }
    return Uint8Array.from(bytes);
}

function glyphWidth(byte) {
    if (byte >= 0x20 && byte <= 0x7e) return HELVETICA_ASCII[byte - 0x20];
    if (HELVETICA_EXTRA[byte] !== undefined) return HELVETICA_EXTRA[byte];
    if (byte >= 0xc0) {
        const base = String.fromCharCode(byte).normalize('NFD')[0].charCodeAt(0);
        if (base >= 0x20 && base <= 0x7e) return HELVETICA_ASCII[base - 0x20];
    }
    return 556;
}

export function helveticaWidth(bytes, size) {
    let total = 0;
    for (const byte of bytes) total += glyphWidth(byte);
    return (total * size) / 1000;
}

function literal(bytes) {
    let result = '(';
    for (const byte of bytes) {
        if (byte === 0x28 || byte === 0x29 || byte === 0x5c) result += `\\${String.fromCharCode(byte)}`;
        else if (byte < 0x20 || byte > 0x7e) result += `\\${byte.toString(8).padStart(3, '0')}`;
        else result += String.fromCharCode(byte);
    }
    return `${result})`;
}

function utf16Hex(text) {
    let hex = 'FEFF';
    for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
    return `<${hex}>`;
}

function number(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? '0' : String(rounded);
}

function pdfDate(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function readJpegInfo(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    let adobe = false;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xff) {
            offset += 1;
            continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (length < 2) return null;
        if (marker === 0xee) adobe = true;
        const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (sof && offset + 9 < bytes.length) {
            return {
                height: (bytes[offset + 5] << 8) | bytes[offset + 6],
                width: (bytes[offset + 7] << 8) | bytes[offset + 8],
                components: bytes[offset + 9],
                adobe
            };
        }
        if (marker === 0xda || marker === 0xd9) return null;
        offset += 2 + length;
    }
    return null;
}

function pageGeometry(page) {
    const width = Number(page.width);
    const height = Number(page.height);
    if (!(width > 0) || !(height > 0)) throw new TypeError('Each PDF page needs a positive width and height');
    let scale = PDF_LIMITS.pointsPerUnit;
    const largest = Math.max(width, height) * scale;
    if (largest > PDF_LIMITS.maxPagePoints) scale *= PDF_LIMITS.maxPagePoints / largest;
    const smallest = Math.min(width, height) * scale;
    if (smallest < PDF_LIMITS.minPagePoints && Math.max(width, height) * scale * (PDF_LIMITS.minPagePoints / smallest) <= PDF_LIMITS.maxPagePoints) {
        scale *= PDF_LIMITS.minPagePoints / smallest;
    }
    return { scale, width: width * scale, height: height * scale };
}

function textOperators(texts, geometry) {
    const parts = [];
    for (const entry of (texts ?? []).slice(0, PDF_LIMITS.maxTexts)) {
        const bytes = toWinAnsi(String(entry?.text ?? '').replace(/\s+/g, ' ').trim());
        const size = Number(entry?.size) * geometry.scale;
        const x = Number(entry?.x) * geometry.scale;
        const baseline = geometry.height - Number(entry?.y) * geometry.scale;
        if (!bytes.length || !(size > 0) || !Number.isFinite(x) || !Number.isFinite(baseline)) continue;
        let scaling = 100;
        const target = Number(entry?.width) * geometry.scale;
        const natural = helveticaWidth(bytes, size);
        if (target > 0 && natural > 0) scaling = Math.min(1000, Math.max(10, (100 * target) / natural));
        parts.push(`/F1 ${number(size)} Tf ${number(scaling)} Tz 1 0 0 1 ${number(x)} ${number(baseline)} Tm ${literal(bytes)} Tj`);
    }
    return parts.length ? `BT\n3 Tr\n${parts.join('\n')}\nET\n` : '';
}

class PdfWriter {
    constructor() {
        this.chunks = [];
        this.length = 0;
        this.offsets = [];
    }

    write(data) {
        const bytes = typeof data === 'string' ? ascii(data) : data;
        this.chunks.push(bytes);
        this.length += bytes.length;
    }

    object(id, body, stream) {
        this.offsets[id] = this.length;
        this.write(`${id} 0 obj\n`);
        if (stream) {
            this.write(`${body}\nstream\n`);
            this.write(stream);
            this.write('\nendstream\nendobj\n');
        } else {
            this.write(`${body}\nendobj\n`);
        }
    }

    finish(rootId, infoId) {
        const size = this.offsets.length;
        const xref = this.length;
        let table = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
        for (let id = 1; id < size; id += 1) table += `${String(this.offsets[id]).padStart(10, '0')} 00000 n\r\n`;
        this.write(`${table}trailer\n<< /Size ${size} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
        const result = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
}

export function buildPdf(pages, { title = '', lang, producer = 'capidocs', creationDate = new Date() } = {}) {
    if (!Array.isArray(pages) || !pages.length) throw new TypeError('buildPdf needs at least one page');
    const writer = new PdfWriter();
    writer.write('%PDF-1.7\n');
    writer.write(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const catalogId = 1;
    const pagesId = 2;
    const fontId = 3;
    const infoId = 4;
    let nextId = 5;
    const layout = pages.map((page) => {
        const ids = { page: nextId++, contents: nextId++ };
        if (page.jpeg !== undefined && page.jpeg !== null) ids.image = nextId++;
        return ids;
    });

    const language = lang ? ` /Lang ${utf16Hex(String(lang))}` : '';
    writer.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /ViewerPreferences << /DisplayDocTitle true >>${language} >>`);
    writer.object(pagesId, `<< /Type /Pages /Kids [${layout.map((ids) => `${ids.page} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    writer.object(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    writer.object(infoId, `<< /Title ${utf16Hex(String(title ?? ''))} /Producer ${utf16Hex(String(producer))} /Creator ${utf16Hex(String(producer))} /CreationDate (${pdfDate(creationDate)}) >>`);

    pages.forEach((page, index) => {
        const ids = layout[index];
        const geometry = pageGeometry(page);
        let content = '';
        let resources = `/Font << /F1 ${fontId} 0 R >>`;
        if (ids.image) {
            const jpeg = page.jpeg instanceof Uint8Array ? page.jpeg : null;
            const info = jpeg ? readJpegInfo(jpeg) : null;
            if (!info) throw new TypeError(`Page ${index + 1} does not contain a baseline or progressive JPEG`);
            const width = info.width || Number(page.imageWidth);
            const height = info.height || Number(page.imageHeight);
            const colorSpace = info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
            const decode = info.components === 4 && info.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
            writer.object(ids.image, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${jpeg.length} >>`, jpeg);
            resources += ` /XObject << /Im${index + 1} ${ids.image} 0 R >>`;
            content += `q\n${number(geometry.width)} 0 0 ${number(geometry.height)} 0 0 cm\n/Im${index + 1} Do\nQ\n`;
        }
        content += textOperators(page.texts, geometry);
        const stream = ascii(content);
        writer.object(ids.page, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${number(geometry.width)} ${number(geometry.height)}] /Resources << ${resources} /ProcSet [/PDF /Text /ImageB /ImageC] >> /Contents ${ids.contents} 0 R >>`);
        writer.object(ids.contents, `<< /Length ${stream.length} >>`, stream);
    });

    return writer.finish(catalogId, infoId);
}
