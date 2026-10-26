import { LIMITS } from '../model.js';
import { combineSets } from './combine.js';
import { looksLikeDiagram, looksLikeSet, setFromJsonValue } from './json.js';
import { parseMermaid } from './mermaid.js';
import { ImportError, Warnings, buildSet, clip, htmlToText, lines } from './shared.js';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`{]*)?/;
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const MAX_TEXT = LIMITS.longText * 2;

function headingText(row, marker) {
    let text = row.slice(marker.length).trim();
    let end = text.length;
    while (end > 0 && text[end - 1] === '#') end -= 1;
    if (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t') text = text.slice(0, end).trimEnd();
    return text;
}
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'capidocs-diagram', 'json']);

export function inlineMarkdownToText(text) {
    const plain = String(text ?? '').slice(0, MAX_TEXT)
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2')
        .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1$2');
    return lines(htmlToText(plain)).join(' ');
}

export function scanMarkdown(source) {
    const rows = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let titleHeading = null;
    let heading = null;
    let paragraph = null;

    const finishParagraph = () => {
        if (!paragraph) return;
        const text = clip(inlineMarkdownToText(paragraph.lines.join(' ')), LIMITS.longText);
        if (text && paragraph.owner.description === undefined) paragraph.owner.description = text;
        paragraph = null;
    };
    const closeHeading = () => {
        if (heading) heading.open = false;
    };

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const fence = FENCE_OPEN.exec(row);
        if (fence) {
            finishParagraph();
            closeHeading();
            const marker = fence[1];
            const language = String(fence[2] ?? '').toLowerCase();
            const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
            let end = index + 1;
            while (end < rows.length && !closing.test(rows[end])) end += 1;
            if (DIAGRAM_LANGUAGES.has(language)) {
                blocks.push({
                    language,
                    content: rows.slice(index + 1, end).join('\n'),
                    heading: heading ? { title: heading.title, description: heading.description } : null,
                    line: index + 1
                });
            }
            index = end;
            continue;
        }
        const match = HEADING.exec(row);
        if (match) {
            finishParagraph();
            closeHeading();
            const level = match[1].length;
            const text = clip(inlineMarkdownToText(headingText(row, match[0])), 120);
            if (level <= 2 && text) {
                heading = { level, title: text, description: undefined, open: true };
                if (level === 1 && !titleHeading) titleHeading = heading;
            }
            continue;
        }
        if (!row.trim()) {
            finishParagraph();
            continue;
        }
        const line = row.trim().replace(/^>\s?/, '');
        if (paragraph) {
            if (paragraph.length < MAX_TEXT) paragraph.lines.push(line);
            paragraph.length += line.length;
        } else if (heading?.open && !/^\s*(\||<|[-*+]\s|\d+\.\s)/.test(row)) {
            paragraph = { owner: heading, lines: [line], length: line.length };
        }
        closeHeading();
    }
    finishParagraph();
    return { title: titleHeading?.title, description: titleHeading?.description, blocks };
}

export function importMarkdown(source, options = {}) {
    const warnings = new Warnings();
    const lang = options.lang ?? 'es';
    const scan = scanMarkdown(source);
    const parts = [];
    for (const block of scan.blocks) {
        const label = `line ${block.line}`;
        if (block.language === 'mermaid') {
            try {
                const parsed = parseMermaid(block.content, { lang });
                warnings.merge(parsed.warnings);
                const diagram = { ...parsed.diagram };
                if (!parsed.explicitTitle && block.heading?.title) {
                    diagram.title = block.heading.title;
                    diagram.id = block.heading.title;
                }
                if (!diagram.description && block.heading?.description) diagram.description = block.heading.description;
                parts.push({ label, set: buildSet({ title: diagram.title, lang, diagrams: [diagram] }) });
            } catch (error) {
                if (!(error instanceof ImportError)) throw error;
                warnings.add('invalid_block', `${label}: ${error.detail}`);
            }
            continue;
        }
        let value;
        try {
            value = JSON.parse(block.content);
        } catch {
            if (block.language === 'capidocs-diagram') warnings.add('invalid_block', `${label}: invalid JSON`);
            continue;
        }
        if (block.language === 'json' && !looksLikeSet(value) && !looksLikeDiagram(value)) continue;
        try {
            const set = setFromJsonValue(value, { title: block.heading?.title, lang });
            if (!looksLikeSet(value) && set.diagrams.length === 1 && !set.diagrams[0].title && block.heading?.title) {
                set.diagrams[0] = { ...set.diagrams[0], title: block.heading.title };
            }
            parts.push({ label, set });
        } catch (error) {
            if (!(error instanceof ImportError)) throw error;
            warnings.add('invalid_block', `${label}: ${error.detail}`);
        }
    }
    if (!parts.length) throw new ImportError('empty', 'No diagram blocks were found in the Markdown file');
    const set = combineSets(parts, { title: scan.title ?? options.title, description: scan.description, lang }, warnings);
    return { set, warnings: warnings.list };
}
