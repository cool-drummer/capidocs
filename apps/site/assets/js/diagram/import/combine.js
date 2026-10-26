import { LIMITS, mergeDiagramSets, serializeDiagramSet, validateDiagramSet } from '../model.js';
import { ImportError, clip, fallbackText } from './shared.js';

function firstIssue(issues) {
    const issue = issues[0];
    return issue ? `${issue.path}: ${issue.message}` : 'Invalid diagram';
}

export function validateOrThrow(raw) {
    const result = validateDiagramSet(raw);
    if (!result.ok) throw new ImportError('invalid_model', firstIssue(result.issues), result.issues);
    return result.set;
}

export function combineSets(parts, { title, description, lang = 'es' } = {}, warnings) {
    let merged = null;
    let total = 0;
    for (const part of parts) {
        const result = validateDiagramSet(part.set);
        if (!result.ok) {
            warnings?.add('invalid_block', `${part.label ?? 'block'}: ${firstIssue(result.issues)}`);
            continue;
        }
        if (total + result.set.diagrams.length > LIMITS.diagrams) {
            warnings?.add('limit_exceeded', `Only the first ${LIMITS.diagrams} diagrams were kept`);
            break;
        }
        total += result.set.diagrams.length;
        if (!merged) {
            merged = result.set;
            continue;
        }
        const next = mergeDiagramSets(merged, result.set);
        if (!next.ok) {
            warnings?.add('invalid_block', `${part.label ?? 'block'}: ${firstIssue(next.issues)}`);
            continue;
        }
        merged = next.set;
    }
    if (!merged) throw new ImportError('empty', 'No importable diagrams were found');
    const serialized = serializeDiagramSet(merged);
    serialized.title = clip(title, 120) ?? serialized.title ?? fallbackText(lang, 'set');
    const text = clip(description, LIMITS.longText);
    if (text) serialized.description = text;
    serialized.lang = lang;
    return validateOrThrow(serialized);
}
