import { DEFAULT_CATEGORIES, LIMITS, combineDiagramSets, validateDiagramSet } from '../model.js';
import { ImportError, clip, fallbackText } from './shared.js';

const MAX_CATEGORIES = 24;

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
    const sets = [];
    const categories = new Set();
    const icons = new Set();
    let total = 0;
    for (const part of parts) {
        const result = part.trusted
            ? { ok: true, set: { categories: DEFAULT_CATEGORIES, icons: {}, ...part.set } }
            : validateDiagramSet(part.set);
        if (!result.ok) {
            warnings?.add('invalid_block', `${part.label ?? 'block'}: ${firstIssue(result.issues)}`);
            continue;
        }
        if (total + result.set.diagrams.length > LIMITS.diagrams) {
            warnings?.add('limit_exceeded', `Only the first ${LIMITS.diagrams} diagrams were kept`);
            break;
        }
        const newCategories = result.set.categories.filter((category) => !categories.has(category.id));
        const newIcons = Object.keys(result.set.icons).filter((name) => !icons.has(name));
        if (categories.size + newCategories.length > MAX_CATEGORIES || icons.size + newIcons.length > LIMITS.icons) {
            warnings?.add('invalid_block', `${part.label ?? 'block'}: too many categories or icons`);
            continue;
        }
        newCategories.forEach((category) => categories.add(category.id));
        newIcons.forEach((name) => icons.add(name));
        total += result.set.diagrams.length;
        sets.push(result.set);
    }
    if (!sets.length) throw new ImportError('empty', 'No importable diagrams were found');
    const overrides = { title: clip(title, 120) ?? sets[0].title ?? fallbackText(lang, 'set'), lang };
    const text = clip(description, LIMITS.longText);
    if (text) overrides.description = text;
    const result = combineDiagramSets(sets, overrides);
    if (!result.ok) throw new ImportError('invalid_model', firstIssue(result.issues), result.issues);
    return result.set;
}
