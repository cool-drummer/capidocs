#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const target = resolve(process.argv[2] ?? 'apps/site/assets/vendor');

const LANGUAGES = [
    'markup', 'css', 'clike', 'javascript', 'typescript', 'jsx', 'tsx', 'json', 'json5', 'bash', 'shell-session',
    'powershell', 'batch', 'python', 'php', 'ruby', 'go', 'rust', 'java', 'kotlin', 'swift', 'csharp', 'c', 'cpp',
    'dart', 'scala', 'http', 'yaml', 'toml', 'ini', 'docker', 'nginx', 'sql', 'graphql', 'diff', 'markdown', 'regex',
    'protobuf', 'hcl', 'lua', 'perl', 'r', 'elixir', 'erlang', 'haskell', 'makefile', 'git', 'csv', 'log',
    'properties', 'apacheconf', 'xml-doc', 'markup-templating', 'mermaid'
];

const prismRoot = dirname(require.resolve('prismjs/package.json'));
const fontAwesomeRoot = dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const components = JSON.parse(readFileSync(join(prismRoot, 'components.json'), 'utf8')).languages;

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const selected = new Set();
const visit = (id) => {
    if (selected.has(id) || id === 'meta') return;
    if (!components[id]) throw new Error(`Unknown Prism language "${id}"`);
    selected.add(id);
    [...asList(components[id].require), ...asList(components[id].optional), ...asList(components[id].modify)]
        .filter((dependency) => LANGUAGES.includes(dependency) || asList(components[id].require).includes(dependency))
        .forEach(visit);
};
LANGUAGES.forEach(visit);

const copy = (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
};

rmSync(join(target, 'prism'), { recursive: true, force: true });
rmSync(join(target, 'fontawesome'), { recursive: true, force: true });

copy(join(prismRoot, 'LICENSE'), join(target, 'prism/LICENSE'));
copy(join(prismRoot, 'components/prism-core.min.js'), join(target, 'prism/prism-core.min.js'));
for (const plugin of ['autoloader/prism-autoloader.min.js', 'normalize-whitespace/prism-normalize-whitespace.min.js']) {
    copy(join(prismRoot, 'plugins', plugin), join(target, 'prism/plugins', plugin));
}
for (const id of [...selected].sort()) {
    copy(join(prismRoot, `components/prism-${id}.min.js`), join(target, `prism/components/prism-${id}.min.js`));
}

copy(join(fontAwesomeRoot, 'LICENSE.txt'), join(target, 'fontawesome/LICENSE.txt'));
copy(join(fontAwesomeRoot, 'css/all.min.css'), join(target, 'fontawesome/css/all.min.css'));
for (const file of readdirSync(join(fontAwesomeRoot, 'webfonts'))) {
    if (file.endsWith('.woff2')) copy(join(fontAwesomeRoot, 'webfonts', file), join(target, 'fontawesome/webfonts', file));
}

process.stdout.write(`Vendored Prism core with ${selected.size} languages and Font Awesome into ${target}\n`);
