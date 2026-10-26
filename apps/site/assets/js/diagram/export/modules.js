const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const IDENTIFIER = /[A-Za-z_$\u00c0-\uffff][\w$\u00c0-\uffff]*/y;
const NUMBER = /(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)n?/y;
export const MAX_MODULES = 400;

function readString(source, start) {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
        const char = source[index];
        if (char === '\\') index += 2;
        else if (char === quote) return index + 1;
        else if (char === '\n') throw new SyntaxError(`Unterminated string at ${start}`);
        else index += 1;
    }
    throw new SyntaxError(`Unterminated string at ${start}`);
}

function readRegex(source, start) {
    let index = start + 1;
    let inClass = false;
    while (index < source.length) {
        const char = source[index];
        if (char === '\n') return -1;
        if (char === '\\') index += 2;
        else if (char === '[') {
            inClass = true;
            index += 1;
        } else if (char === ']') {
            inClass = false;
            index += 1;
        } else if (char === '/' && !inClass) {
            index += 1;
            while (/[a-z]/i.test(source[index] ?? '')) index += 1;
            return index;
        } else index += 1;
    }
    return -1;
}

export function tokenize(source) {
    const tokens = [];
    const templates = [];
    let index = 0;
    let previous = null;
    const regexAllowed = () => {
        if (!previous) return true;
        if (previous.type === 'punct') return ![')', ']'].includes(previous.value);
        if (previous.type === 'name') return REGEX_KEYWORDS.has(previous.value);
        return false;
    };
    const push = (token) => {
        tokens.push(token);
        previous = token;
    };
    const readTemplate = (from) => {
        let cursor = from;
        while (cursor < source.length) {
            const char = source[cursor];
            if (char === '\\') cursor += 2;
            else if (char === '`') {
                push({ type: 'template', start: from - 1, end: cursor + 1 });
                return cursor + 1;
            } else if (char === '$' && source[cursor + 1] === '{') {
                templates.push(0);
                push({ type: 'punct', value: '${', start: cursor, end: cursor + 2 });
                return cursor + 2;
            } else cursor += 1;
        }
        throw new SyntaxError(`Unterminated template at ${from}`);
    };

    while (index < source.length) {
        const char = source[index];
        if (/\s/.test(char)) {
            index += 1;
            continue;
        }
        if (char === '/' && source[index + 1] === '/') {
            const end = source.indexOf('\n', index);
            index = end === -1 ? source.length : end;
            continue;
        }
        if (char === '/' && source[index + 1] === '*') {
            const end = source.indexOf('*/', index + 2);
            if (end === -1) throw new SyntaxError(`Unterminated comment at ${index}`);
            index = end + 2;
            continue;
        }
        if (char === '"' || char === "'") {
            const end = readString(source, index);
            push({ type: 'string', start: index, end, value: source.slice(index + 1, end - 1) });
            index = end;
            continue;
        }
        if (char === '`') {
            index = readTemplate(index + 1);
            continue;
        }
        if (char === '{') {
            if (templates.length) templates[templates.length - 1] += 1;
            push({ type: 'punct', value: char, start: index, end: index + 1 });
            index += 1;
            continue;
        }
        if (char === '}') {
            if (templates.length && templates[templates.length - 1] === 0) {
                templates.pop();
                index = readTemplate(index + 1);
                continue;
            }
            if (templates.length) templates[templates.length - 1] -= 1;
            push({ type: 'punct', value: char, start: index, end: index + 1 });
            index += 1;
            continue;
        }
        if (char === '/' && regexAllowed()) {
            const end = readRegex(source, index);
            if (end !== -1) {
                push({ type: 'regex', start: index, end });
                index = end;
                continue;
            }
        }
        IDENTIFIER.lastIndex = index;
        const name = IDENTIFIER.exec(source);
        if (name) {
            push({ type: 'name', value: name[0], start: index, end: index + name[0].length });
            index += name[0].length;
            continue;
        }
        NUMBER.lastIndex = index;
        const numeric = NUMBER.exec(source);
        if (numeric) {
            push({ type: 'number', start: index, end: index + numeric[0].length });
            index += numeric[0].length;
            continue;
        }
        push({ type: 'punct', value: char, start: index, end: index + 1 });
        index += 1;
    }
    return tokens;
}

export function findStaticImports(source) {
    const tokens = tokenize(source);
    const imports = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type !== 'name' || (token.value !== 'import' && token.value !== 'export')) continue;
        const before = tokens[index - 1];
        if (before && before.type === 'punct' && before.value === '.') continue;
        const next = tokens[index + 1];
        if (!next) continue;
        if (token.value === 'import') {
            if (next.type === 'punct' && (next.value === '(' || next.value === '.')) continue;
            if (next.type === 'string') {
                imports.push(next);
                continue;
            }
        } else if (!(next.type === 'punct' && (next.value === '*' || next.value === '{'))) {
            continue;
        }
        let depth = 0;
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
            const current = tokens[cursor];
            if (current.type === 'punct' && current.value === '{') depth += 1;
            else if (current.type === 'punct' && current.value === '}') depth -= 1;
            else if (current.type === 'punct' && current.value === ';' && depth === 0) break;
            else if (depth === 0 && current.type === 'name' && current.value === 'from') {
                const specifier = tokens[cursor + 1];
                if (specifier?.type === 'string') imports.push(specifier);
                break;
            }
            if (depth < 0) break;
        }
    }
    return imports.map((token) => ({ specifier: token.value, start: token.start + 1, end: token.end - 1 }));
}

export function resolveSpecifier(fromPath, specifier) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error(`Only relative imports can be bundled: "${specifier}" in ${fromPath}`);
    }
    const parts = fromPath.split('/').slice(0, -1);
    for (const segment of specifier.split('/')) {
        if (segment === '.' || segment === '') continue;
        if (segment === '..') {
            if (!parts.length) throw new Error(`Import "${specifier}" in ${fromPath} leaves the site root`);
            parts.pop();
        } else parts.push(segment);
    }
    return parts.join('/');
}

export async function collectModules(entry, readText) {
    const normalizedEntry = resolveSpecifier('index.html', `./${String(entry).replace(/^\.?\//, '')}`);
    const modules = new Map();
    const order = [];
    const visiting = new Set();

    const visit = async (path, trail) => {
        if (modules.has(path)) return;
        if (visiting.has(path)) throw new Error(`Import cycle: ${[...trail, path].join(' -> ')}`);
        if (visiting.size + modules.size >= MAX_MODULES) throw new Error(`More than ${MAX_MODULES} modules`);
        visiting.add(path);
        const source = await readText(path);
        const imports = findStaticImports(source).map((entry) => ({ ...entry, path: resolveSpecifier(path, entry.specifier) }));
        for (const dependency of imports) await visit(dependency.path, [...trail, path]);
        visiting.delete(path);
        modules.set(path, { path, source, imports });
        order.push(path);
    };

    await visit(normalizedEntry, []);
    return { entry: normalizedEntry, modules: order.map((path) => modules.get(path)) };
}
