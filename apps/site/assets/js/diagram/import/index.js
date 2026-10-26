import { LIMITS, validateDiagramSet } from '../model.js';
import { attribute, parseXml, rootElement } from '../xml.js';
import { isDrawioText, parseDrawio } from './drawio.js';
import { importHtml } from './html.js';
import { importJson } from './json.js';
import { importMarkdown } from './markdown.js';
import { importMermaid, looksLikeMermaid } from './mermaid.js';
import { ImportError, exceedsByteLimit } from './shared.js';

export const IMPORT_ERROR_CODES = ['unsupported_format', 'invalid_json', 'invalid_model', 'too_large', 'empty', 'parse_error'];
export const IMPORT_FORMATS = ['json', 'mermaid', 'markdown', 'drawio', 'html', 'svg'];
export const IMPORT_EXTENSIONS = ['.json', '.mmd', '.mermaid', '.md', '.markdown', '.drawio', '.dio', '.xml', '.html', '.htm', '.svg'];

const EXTENSIONS = {
    json: 'json', mmd: 'mermaid', mermaid: 'mermaid', md: 'markdown', markdown: 'markdown', mdx: 'markdown',
    drawio: 'drawio', dio: 'drawio', xml: 'drawio', html: 'html', htm: 'html', xhtml: 'html', svg: 'svg'
};

function extensionOf(name) {
    const match = /\.([a-z0-9]{1,10})$/.exec(String(name ?? '').toLowerCase());
    return match ? match[1] : '';
}

function baseName(name) {
    const file = String(name ?? '').split(/[\\/]/).pop() ?? '';
    const stem = file.replace(/(\.drawio)?\.[A-Za-z0-9]{1,10}$/, '');
    return stem.trim() || undefined;
}

export function sniffFormat(text) {
    const head = String(text ?? '').slice(0, 4096).replace(/^\ufeff/, '').trimStart();
    if (head.startsWith('{') || head.startsWith('[')) return 'json';
    if (isDrawioText(head)) return 'drawio';
    if (/^(?:<\?xml[^>]{0,200}>\s*)?(?:<!--[^>]{0,2000}-->\s*)?(?:<!DOCTYPE svg[^>]{0,500}>\s*)?<svg\b/i.test(head)) return 'svg';
    if (head.startsWith('<')) return 'html';
    if (/^ {0,3}(?:`{3,}|~{3,})[ \t]*(?:mermaid|capidocs-diagram)\b/m.test(String(text))) return 'markdown';
    if (looksLikeMermaid(head)) return 'mermaid';
    if (/^ {0,3}#{1,6}[ \t]/m.test(head)) return 'markdown';
    return undefined;
}

export function detectFormat(text, name) {
    return EXTENSIONS[extensionOf(name)] ?? sniffFormat(text);
}

async function importSvg(text, options) {
    let content;
    try {
        content = attribute(rootElement(parseXml(text)), 'content');
    } catch {
        content = undefined;
    }
    if (content && isDrawioText(content)) return parseDrawio(content, options);
    return importHtml(text, options);
}

async function parseByFormat(format, text, options) {
    switch (format) {
        case 'json': return importJson(text, options);
        case 'mermaid': return importMermaid(text, { lang: options.lang, title: options.title });
        case 'markdown': return importMarkdown(text, options);
        case 'drawio': return parseDrawio(text, options);
        case 'html': return importHtml(text, options);
        case 'svg': return importSvg(text, options);
        default: throw new ImportError('unsupported_format', `Unsupported format "${format}"`);
    }
}

function failure(code, detail, issues) {
    const result = { ok: false, error: { code, detail: String(detail ?? code) } };
    if (issues?.length) result.issues = issues;
    return result;
}

export async function importDiagramFile(file, options = {}) {
    try {
        const name = file?.name ?? '';
        const text = file?.text;
        if (typeof text !== 'string') return failure('parse_error', 'Expected the file content as text');
        if (exceedsByteLimit(text)) return failure('too_large', `The file is larger than ${LIMITS.fileBytes} bytes`);
        if (!text.trim()) return failure('empty', 'The file is empty');
        const format = IMPORT_FORMATS.includes(options.format) ? options.format : detectFormat(text, name);
        if (!format) return failure('unsupported_format', 'The file format was not recognized');
        const parsed = await parseByFormat(format, text, {
            lang: options.lang ?? 'es',
            layout: options.layout === 'auto' ? 'auto' : 'keep',
            title: options.title ?? baseName(name)
        });
        const result = validateDiagramSet(parsed.set);
        if (!result.ok) {
            const first = result.issues[0];
            return failure('invalid_model', first ? `${first.path}: ${first.message}` : 'Invalid diagram set', result.issues);
        }
        return { ok: true, set: result.set, warnings: parsed.warnings ?? [], format };
    } catch (error) {
        if (error instanceof ImportError) return failure(error.code, error.detail, error.issues);
        return failure('parse_error', error instanceof Error ? error.message : 'Unexpected error');
    }
}

export function importDiagramText(text, { hint, ...options } = {}) {
    const hinted = String(hint ?? '').toLowerCase();
    const format = IMPORT_FORMATS.includes(hinted) ? hinted : EXTENSIONS[hinted.replace(/^.*\./, '')];
    return importDiagramFile({ name: '', text }, { ...options, format: options.format ?? format });
}
