export function slug(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export function orderedRoutes(spec) {
    const out = [];
    const seen = new Set();
    const push = (id, title) => {
        if (id && !seen.has(id)) {
            seen.add(id);
            out.push({ id, title: title || id });
        }
    };
    (spec.navigation || []).forEach((item) => {
        if (item.type === 'page' || !item.type) push(item.id, item.title);
    });
    (spec.sections || []).forEach((section) => {
        (section.pages || []).forEach((page) => push(page.id, page.title));
        (section.endpoints || []).forEach((endpoint) => push(endpoint.id, endpoint.title));
    });
    return out;
}

export function pageGroupMap(spec) {
    const map = {};
    (spec.navigation || []).forEach((item) => { map[item.id] = 'nav_guides'; });
    (spec.sections || []).forEach((section) => {
        (section.endpoints || []).forEach((endpoint) => { map[endpoint.id] = section.title; });
        (section.pages || []).forEach((page) => { map[page.id] = section.title; });
    });
    return map;
}

export function stripTags(html) {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sectionText(section) {
    return [
        section.title,
        section.content,
        section.prose ? stripTags(section.prose) : '',
        section.note,
        section.warning,
        Array.isArray(section.list) ? section.list.join(' ') : '',
        section.table ? (section.table.headers || []).join(' ') : '',
        section.callout ? [section.callout.title, section.callout.content].filter(Boolean).join(' ') : ''
    ].filter(Boolean).join(' ');
}

export function buildSearchIndex(spec, labels = {}) {
    const guideLabel = labels.guide || 'Guía';
    const pageLabel = labels.page || 'Página';
    const entries = [];
    const pages = spec.pages || {};
    const endpoints = spec.endpoints || {};
    const seenPage = new Set();

    (spec.navigation || []).forEach((item) => {
        if (item.type === 'page' || !item.type) {
            entries.push({ type: 'page', title: item.title, route: item.id, subtitle: guideLabel, text: item.title });
            seenPage.add(item.id);
        }
    });

    Object.entries(pages).forEach(([id, page]) => {
        const content = page.content || {};
        const pageTitle = content.title || (content.hero && content.hero.title) || id;
        if (!seenPage.has(id)) {
            entries.push({
                type: 'page',
                title: pageTitle,
                route: id,
                subtitle: pageLabel,
                text: [pageTitle, content.description].filter(Boolean).join(' ')
            });
            seenPage.add(id);
        }
        (content.sections || []).forEach((section) => {
            if (!section.title) return;
            entries.push({
                type: 'section',
                title: section.title,
                route: id,
                anchor: slug(section.title),
                subtitle: pageTitle,
                text: sectionText(section)
            });
        });
    });

    Object.entries(endpoints).forEach(([id, endpoint]) => {
        entries.push({
            type: 'endpoint',
            title: endpoint.title || id,
            method: endpoint.method || '',
            path: endpoint.path || '',
            route: id,
            subtitle: [endpoint.method, endpoint.path].filter(Boolean).join(' '),
            text: [endpoint.title, endpoint.description, endpoint.path, endpoint.method].filter(Boolean).join(' ')
        });
    });

    return entries;
}

export function codeText(block) {
    if (!block) return '';
    const raw = block.content != null ? block.content : block.code;
    return Array.isArray(raw) ? raw.join('\n') : String(raw || '');
}

function fence(block) {
    return ['```' + (block.language || ''), codeText(block), '```'];
}

export function pageMarkdown(spec, route) {
    const pages = spec.pages || {};
    const endpoints = spec.endpoints || {};
    const lines = [];

    if (pages[route]) {
        const content = pages[route].content || {};
        if (content.hero) {
            lines.push('# ' + (content.hero.title || route));
            if (content.hero.subtitle) lines.push('', content.hero.subtitle);
            return lines.join('\n');
        }
        lines.push('# ' + (content.title || route));
        if (content.description) lines.push('', content.description);
        (content.sections || []).forEach((section) => {
            lines.push('', '## ' + section.title);
            if (section.content) lines.push('', section.content);
            if (section.prose) lines.push('', stripTags(section.prose));
            if (section.note) lines.push('', '> Note: ' + section.note);
            if (section.warning) lines.push('', '> Warning: ' + section.warning);
            if (section.callout) {
                lines.push('', '> ' + (section.callout.title ? section.callout.title + ': ' : '') + (section.callout.content || ''));
            }
            (section.list || []).forEach((item) => lines.push('- ' + item));
            if (section.table) {
                lines.push('', '| ' + section.table.headers.join(' | ') + ' |', '| ' + section.table.headers.map(() => '---').join(' | ') + ' |');
                (section.table.rows || []).forEach((row) => lines.push('| ' + row.join(' | ') + ' |'));
            }
            if (section.image) {
                lines.push('', '![' + (section.image.alt || '') + '](' + section.image.src + ')');
                if (section.image.caption) lines.push('', '_' + section.image.caption + '_');
            }
            if (section.code) lines.push('', ...fence(section.code));
            (section.code_group || []).forEach((group) => lines.push('', ...fence(group)));
            (section.steps || []).forEach((step) => {
                lines.push('', (step.number ? step.number + '. ' : '- ') + step.title + (step.description ? ': ' + step.description : ''));
            });
            (section.fields || []).forEach((field) => {
                lines.push('- `' + field.name + '` (' + (field.type || '') + (field.required ? ', required' : '') + ')' + (field.description ? ' — ' + field.description : ''));
            });
        });
        return lines.join('\n');
    }

    if (endpoints[route]) {
        const endpoint = endpoints[route];
        lines.push('# ' + (endpoint.title || route), '', '`' + (endpoint.method || 'GET') + ' ' + (endpoint.path || '') + '`');
        if (endpoint.description) lines.push('', endpoint.description);
        (endpoint.code_examples || []).forEach((example) => {
            lines.push('', '### ' + (example.name || example.tech || example.language || 'Example'), '', ...fence(example));
        });
        return lines.join('\n');
    }

    return '# ' + route;
}

export function pageSummary(spec, route, maxLength = 140) {
    const lines = pageMarkdown(spec, route).split('\n').filter(Boolean);
    return (lines[2] || lines[1] || '').replace(/^[#>`\s]+/, '').slice(0, maxLength);
}
