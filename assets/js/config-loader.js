(function () {
    const CONFIG_URL = 'config/api-spec.json';
    const CODE_KEYS = ['code', 'content'];
    const FILE_KEYS = ['file', 'code_file'];
    const EXTENSION_LANGUAGE = {
        sh: 'bash',
        bash: 'bash',
        curl: 'bash',
        py: 'python',
        js: 'javascript',
        ts: 'typescript',
        json: 'json',
        http: 'http',
        html: 'markup',
        xml: 'markup',
        yml: 'yaml',
        yaml: 'yaml',
        txt: 'text'
    };

    let pending = null;
    let loadedConfig = null;

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isStringArray(value) {
        return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string');
    }

    function inferLanguage(path) {
        const match = /\.([a-z0-9]+)$/i.exec(path || '');
        return match ? EXTENSION_LANGUAGE[match[1].toLowerCase()] : undefined;
    }

    function normalizeCode(text) {
        return String(text).replace(/\r\n/g, '\n').replace(/\n$/, '');
    }

    function assignKeyFor(node) {
        if ('code' in node) return 'code';
        if ('content' in node) return 'content';
        if ('tech' in node) return 'code';
        return 'content';
    }

    async function fetchText(path, attempts = 3) {
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const response = await fetch(path);
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ' for ' + path);
                }
                return await response.text();
            } catch (error) {
                lastError = error;
                if (/^HTTP \d/.test(error.message)) break;
            }
        }
        throw lastError;
    }

    function resolveNode(node, tasks) {
        if (Array.isArray(node)) {
            node.forEach(item => resolveNode(item, tasks));
            return;
        }
        if (!isPlainObject(node)) return;

        CODE_KEYS.forEach(key => {
            if (isStringArray(node[key])) {
                node[key] = node[key].join('\n');
            }
        });

        const fileKey = FILE_KEYS.find(key => typeof node[key] === 'string');
        if (fileKey) {
            const path = node[fileKey];
            const target = assignKeyFor(node);
            tasks.push(
                fetchText(path)
                    .then(text => {
                        node[target] = normalizeCode(text);
                        if (!node.language) {
                            const inferred = inferLanguage(path);
                            if (inferred) node.language = inferred;
                        }
                    })
                    .catch(error => {
                        console.error('Failed to load example file:', path, error);
                        if (typeof node[target] !== 'string') {
                            node[target] = '// No se pudo cargar el ejemplo: ' + path;
                        }
                    })
            );
        }

        Object.keys(node).forEach(key => {
            if (FILE_KEYS.indexOf(key) === -1) {
                resolveNode(node[key], tasks);
            }
        });
    }

    function activeConfigUrl() {
        try {
            const override = localStorage.getItem('capidocs_spec_url');
            if (override) return override;
        } catch (e) { /* ignore */ }
        return CONFIG_URL;
    }

    async function doLoad() {
        const url = activeConfigUrl();
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('HTTP ' + response.status + ' loading ' + url);
        }
        const config = JSON.parse(await response.text());
        const tasks = [];
        resolveNode(config, tasks);
        await Promise.all(tasks);
        loadedConfig = config;
        return config;
    }

    window.configLoader = {
        load() {
            if (!pending) {
                pending = doLoad().catch(error => {
                    pending = null;
                    throw error;
                });
            }
            return pending;
        },
        reload() {
            pending = null;
            return this.load();
        },
        ui(key, fallback) {
            const ui = (loadedConfig && loadedConfig.site_config && loadedConfig.site_config.ui) || {};
            return ui[key] != null ? ui[key] : fallback;
        }
    };
})();
