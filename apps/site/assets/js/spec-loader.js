const DEFAULT_SPEC_URL = 'config/api-spec.json';
const OVERRIDE_KEY = 'capidocs_spec_url';
const CODE_KEYS = ['code', 'content'];
const FILE_KEYS = ['file', 'code_file'];
const EXTENSION_LANGUAGE = {
    sh: 'bash', bash: 'bash', curl: 'bash', py: 'python', js: 'javascript', ts: 'typescript',
    json: 'json', http: 'http', html: 'markup', xml: 'markup', yml: 'yaml', yaml: 'yaml', txt: 'text'
};

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string');
}

function inferLanguage(path) {
    const match = /\.([a-z0-9]+)$/i.exec(path || '');
    return match ? EXTENSION_LANGUAGE[match[1].toLowerCase()] : undefined;
}

function normalizeCode(text) {
    return String(text).replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function targetKeyFor(node) {
    if ('code' in node) return 'code';
    if ('content' in node) return 'content';
    if ('tech' in node) return 'code';
    return 'content';
}

async function fetchText(url, attempts = 3) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
            return await response.text();
        } catch (error) {
            lastError = error;
            if (/^HTTP \d/.test(error.message)) break;
        }
    }
    throw lastError;
}

function collectFileTasks(node, tasks, resolveUrl) {
    if (Array.isArray(node)) {
        node.forEach((item) => collectFileTasks(item, tasks, resolveUrl));
        return;
    }
    if (!isPlainObject(node)) return;

    CODE_KEYS.forEach((key) => {
        if (isStringArray(node[key])) node[key] = node[key].join('\n');
    });

    const fileKey = FILE_KEYS.find((key) => typeof node[key] === 'string');
    if (fileKey) {
        const path = node[fileKey];
        const target = targetKeyFor(node);
        tasks.push(
            fetchText(resolveUrl(path))
                .then((text) => {
                    node[target] = normalizeCode(text);
                    if (!node.language) {
                        const inferred = inferLanguage(path);
                        if (inferred) node.language = inferred;
                    }
                })
                .catch((error) => {
                    console.error('Failed to load example file:', path, error);
                    if (typeof node[target] !== 'string') node[target] = '';
                })
        );
    }

    Object.keys(node).forEach((key) => {
        if (!FILE_KEYS.includes(key)) collectFileTasks(node[key], tasks, resolveUrl);
    });
}

export function activeSpecUrl(fallback = DEFAULT_SPEC_URL) {
    try {
        const override = localStorage.getItem(OVERRIDE_KEY);
        if (override) return override;
    } catch {
        return fallback;
    }
    return fallback;
}

export function setSpecOverride(url) {
    try {
        if (url) localStorage.setItem(OVERRIDE_KEY, url);
        else localStorage.removeItem(OVERRIDE_KEY);
    } catch {
        return;
    }
}

export function hasSpecOverride() {
    try {
        return !!localStorage.getItem(OVERRIDE_KEY);
    } catch {
        return false;
    }
}

export async function resolveCodeFiles(spec, base = '') {
    const resolveUrl = (path) => (base ? new URL(path, base).href : path);
    const tasks = [];
    collectFileTasks(spec, tasks, resolveUrl);
    await Promise.all(tasks);
    return spec;
}

export async function loadSpec({ url = activeSpecUrl(), base = '' } = {}) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status + ' loading ' + url);
    const spec = JSON.parse(await response.text());
    return resolveCodeFiles(spec, base);
}

export function createTranslator(spec) {
    const ui = (spec && spec.site_config && spec.site_config.ui) || {};
    return (key, fallback) => (ui[key] != null ? ui[key] : fallback);
}
