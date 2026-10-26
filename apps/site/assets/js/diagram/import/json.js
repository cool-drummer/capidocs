import { DIAGRAM_VERSION, LIMITS, describeJsonError } from '../model.js';
import { ImportError, clip, createIdFactory, fallbackText } from './shared.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function looksLikeSet(value) {
    return isObject(value) && Array.isArray(value.diagrams);
}

export function looksLikeDiagram(value) {
    return isObject(value) && !looksLikeSet(value) && (
        Array.isArray(value.nodes) || Array.isArray(value.participants) || Array.isArray(value.items) || value.kind === 'graph' || value.kind === 'sequence'
    );
}

export function parseJsonText(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ImportError('invalid_json', describeJsonError(error));
    }
}

function wrapDiagrams(diagrams, options) {
    const ids = createIdFactory('diagram', { lower: true });
    const explicit = new Set(diagrams.map((diagram) => diagram.id).filter((id) => typeof id === 'string'));
    const first = diagrams[0];
    return {
        version: DIAGRAM_VERSION,
        title: clip(options.title, 120) ?? (typeof first?.title === 'string' ? clip(first.title, 120) : undefined) ?? fallbackText(options.lang, 'set'),
        lang: options.lang ?? 'es',
        diagrams: diagrams.map((diagram) => {
            if (diagram.id !== undefined) return diagram;
            let id = ids.fresh(typeof diagram.title === 'string' ? diagram.title : 'diagram');
            while (explicit.has(id)) id = ids.fresh(id);
            return { ...diagram, id };
        })
    };
}

export function setFromJsonValue(value, options = {}) {
    if (looksLikeSet(value)) return value;
    if (looksLikeDiagram(value)) return wrapDiagrams([value], options);
    if (Array.isArray(value) && value.length && value.length <= LIMITS.diagrams && value.every(looksLikeDiagram)) return wrapDiagrams(value, options);
    throw new ImportError('invalid_model', 'The JSON is neither a diagram set nor a diagram', [{ path: '(root)', message: 'Expected a diagram set or a diagram' }]);
}

export function importJson(text, options = {}) {
    return { set: setFromJsonValue(parseJsonText(text), options), warnings: [] };
}
