import { escapeAttr, escapeHtml } from './escape.js';
import { sanitizeHtml } from './sanitize.js';
import { codeText, orderedRoutes, pageGroupMap } from './spec-utils.js';

const CALLOUT_TYPES = {
    note: { icon: 'fa-circle-info', cls: 'callout-note' },
    info: { icon: 'fa-circle-info', cls: 'callout-info' },
    tip: { icon: 'fa-lightbulb', cls: 'callout-tip' },
    success: { icon: 'fa-circle-check', cls: 'callout-success' },
    check: { icon: 'fa-circle-check', cls: 'callout-success' },
    warning: { icon: 'fa-triangle-exclamation', cls: 'callout-warning' },
    danger: { icon: 'fa-circle-exclamation', cls: 'callout-danger' },
    error: { icon: 'fa-circle-exclamation', cls: 'callout-danger' }
};

const LANGUAGE_LABELS = {
    bash: 'Terminal', sh: 'Terminal', shell: 'Terminal', curl: 'cURL', javascript: 'JavaScript', js: 'JavaScript',
    typescript: 'TypeScript', ts: 'TypeScript', python: 'Python', json: 'JSON', yaml: 'YAML', html: 'HTML',
    css: 'CSS', php: 'PHP', go: 'Go', ruby: 'Ruby', java: 'Java', text: 'Texto'
};

export class ContentGenerator {
    constructor({ spec, t, resolveAsset = (path) => path }) {
        this.spec = spec;
        this.site = spec.site_config || {};
        this.t = t;
        this.resolveAsset = resolveAsset;
        this.cache = new Map();
        this.sequence = 0;
        this.routes = orderedRoutes(spec);
        this.groupMap = pageGroupMap(spec);
    }

    nextId(prefix) {
        this.sequence += 1;
        return `${prefix}-${this.sequence}`;
    }

    generatePage(pageId) {
        if (this.cache.has(pageId)) return this.cache.get(pageId);

        let content = '';
        const page = this.spec.pages && this.spec.pages[pageId];
        const endpoint = this.spec.endpoints && this.spec.endpoints[pageId];

        if (page && page.template === 'hero') content = this.renderHero(page);
        else if (page) content = this.renderContentPage(page);
        else if (endpoint) content = this.renderEndpoint(endpoint);
        else if (this.findEndpointNav(pageId)) content = this.renderEndpointPlaceholder(this.findEndpointNav(pageId));

        if (!content) content = this.generateNotFoundPage(pageId);

        if (pageId !== 'home') {
            const banner = endpoint || !this.site.show_warning_on_pages || (this.site.exclude_warning_routes || []).includes(pageId)
                ? ''
                : this.generateEnvironmentBanner();
            content = banner + this.generateBreadcrumb(pageId) + content + this.generateFeedback(pageId) + this.generatePrevNext(pageId);
        }

        this.cache.set(pageId, content);
        return content;
    }

    findEndpointNav(pageId) {
        for (const section of this.spec.sections || []) {
            const found = (section.endpoints || []).find((item) => item.id === pageId);
            if (found) return found;
        }
        return null;
    }

    renderHero(page) {
        const { hero, features, steps, quick_start: quickStart } = page.content;
        const logo = this.site.use_logos && this.site.logos && this.site.logos.hero
            ? `<div class="hero-logo"><img src="${escapeAttr(this.resolveAsset(this.site.logos.hero))}" alt="${escapeAttr(this.site.brand || 'Logo')}" class="hero-logo-img"></div>`
            : '';
        return `
            <div class="hero-section">
                <div class="hero-content">
                    ${logo}
                    <h1 class="hero-title">${escapeHtml(hero.title)}</h1>
                    <p class="hero-subtitle">${escapeHtml(hero.subtitle || '')}</p>
                    ${hero.description ? `<p class="hero-description">${escapeHtml(hero.description)}</p>` : ''}
                    ${hero.base_url ? `<div class="url-base"><strong>${escapeHtml(this.t('base_url_label', 'URL base'))}:</strong> <code>${escapeHtml(hero.base_url)}</code></div>` : ''}
                    ${hero.note ? `<div class="note-box">${escapeHtml(hero.note)}</div>` : ''}
                    ${hero.audience ? `<div class="audience-box"><strong>${escapeHtml(this.t('audience_label', 'Audiencia'))}:</strong> ${escapeHtml(hero.audience)}</div>` : ''}
                    ${hero.confidentiality ? `<div class="warning-box"><strong>${escapeHtml(this.t('confidentiality_label', 'Confidencialidad'))}:</strong> ${escapeHtml(hero.confidentiality)}</div>` : ''}
                    ${hero.stats && hero.stats.length ? `
                        <div class="hero-stats">
                            ${hero.stats.map((stat) => `
                                <div class="stat-item">
                                    <span class="stat-number">${escapeHtml(stat.number)}</span>
                                    <span class="stat-label">${escapeHtml(stat.label)}</span>
                                </div>`).join('')}
                        </div>` : ''}
                    ${hero.buttons && hero.buttons.length ? `
                        <div class="hero-buttons">
                            ${hero.buttons.map((button) => `
                                <a href="${escapeAttr(button.href)}" class="btn btn-${escapeAttr(button.type || 'primary')} btn-large">
                                    ${button.icon ? `<i class="${escapeAttr(button.icon)}"></i>` : ''}
                                    ${escapeHtml(button.text)}
                                </a>`).join('')}
                        </div>` : ''}
                </div>
            </div>
            ${features ? this.generateFeaturesSection(features) : ''}
            ${steps ? this.generateStepsSection(steps) : ''}
            ${quickStart ? this.generateQuickStartSection(quickStart) : ''}`;
    }

    renderContentPage(page) {
        const { title, description, sections } = page.content;
        return `
            <div class="content-page">
                <div class="page-header">
                    <h1 class="page-title">${escapeHtml(title)}</h1>
                    ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
                </div>
                <div class="page-content">
                    ${(sections || []).map((section) => this.generateContentSection(section)).join('')}
                </div>
            </div>`;
    }

    generateContentSection(section) {
        return `
            <div class="content-section">
                <div class="section-header">
                    <div class="feature-icon"><i class="fas fa-info-circle"></i></div>
                    <div><h2 class="section-title">${escapeHtml(section.title)}</h2></div>
                </div>
                ${section.content ? `<div class="section-content">${escapeHtml(section.content)}</div>` : ''}
                ${section.prose ? `<div class="section-content section-prose">${sanitizeHtml(section.prose)}</div>` : ''}
                ${section.image ? this.generateImage(section.image) : ''}
                ${section.note ? `<div class="note-box">${escapeHtml(section.note)}</div>` : ''}
                ${section.warning ? `<div class="warning-box">${escapeHtml(section.warning)}</div>` : ''}
                ${section.list ? `<ul class="content-list">${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
                ${section.table ? this.generateTable(section.table) : ''}
                ${section.code ? this.generateCodeBlock(section.code) : ''}
                ${section.steps ? this.generateSteps(section.steps) : ''}
                ${section.callout ? this.generateCallout(section.callout) : ''}
                ${section.cards ? this.generateCards(section.cards) : ''}
                ${section.tabs ? this.generateTabs(section.tabs) : ''}
                ${section.accordion ? this.generateAccordion(section.accordion) : ''}
                ${section.code_group ? this.generateCodeGroup(section.code_group) : ''}
                ${section.fields ? this.generateFields(section.fields) : ''}
            </div>`;
    }

    generateImage(image) {
        return `
            <figure class="section-image">
                <img src="${escapeAttr(this.resolveAsset(image.src))}" alt="${escapeAttr(image.alt || '')}" loading="lazy">
                ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}
            </figure>`;
    }

    generateTable(table) {
        return `
            <div class="table-container">
                <table class="table">
                    <thead><tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    generateSteps(steps) {
        return `
            <div class="steps-list">
                ${steps.map((step) => `
                    <div class="step-item">
                        <div class="step-number">${escapeHtml(step.number)}</div>
                        <div class="step-content">
                            <h4>${escapeHtml(step.title)}</h4>
                            <p>${escapeHtml(step.description || '')}</p>
                            ${step.duration ? `<span class="step-duration">${escapeHtml(step.duration)}</span>` : ''}
                            ${step.link ? `<a href="${escapeAttr(step.link)}" class="step-link">${escapeHtml(this.t('see_more', 'Ver más'))} →</a>` : ''}
                        </div>
                    </div>`).join('')}
            </div>`;
    }

    generateCallout(callout) {
        const type = CALLOUT_TYPES[String(callout.type || 'note').toLowerCase()] || CALLOUT_TYPES.note;
        return `
            <div class="callout ${type.cls}">
                <i class="fas ${type.icon} callout-icon"></i>
                <div class="callout-body">
                    ${callout.title ? `<div class="callout-title">${escapeHtml(callout.title)}</div>` : ''}
                    <div class="callout-content">${escapeHtml(callout.content || '')}</div>
                </div>
            </div>`;
    }

    generateCards(cards) {
        return `
            <div class="cards-grid">
                ${cards.map((card) => {
                    const inner = `
                        ${card.icon ? `<div class="card-icon"><i class="${escapeAttr(card.icon)}"></i></div>` : ''}
                        <div class="card-title">${escapeHtml(card.title)}</div>
                        ${card.description ? `<div class="card-desc">${escapeHtml(card.description)}</div>` : ''}`;
                    return card.link
                        ? `<a class="doc-card doc-card-link" href="${escapeAttr(card.link)}">${inner}</a>`
                        : `<div class="doc-card">${inner}</div>`;
                }).join('')}
            </div>`;
    }

    generateTabs(tabs) {
        const id = this.nextId('dtabs');
        return `
            <div class="doc-tabs">
                <div class="doc-tabs-nav" role="tablist">
                    ${tabs.map((tab, i) => `<button class="doc-tab${i === 0 ? ' active' : ''}" data-tab-target="${id}-${i}" role="tab" aria-selected="${i === 0}">${escapeHtml(tab.label)}</button>`).join('')}
                </div>
                ${tabs.map((tab, i) => `
                    <div class="doc-tab-panel${i === 0 ? ' active' : ''}" id="${id}-${i}" role="tabpanel">
                        ${tab.content ? `<div class="section-content">${escapeHtml(tab.content)}</div>` : ''}
                        ${tab.code ? this.generateCodeBlock(tab.code) : ''}
                    </div>`).join('')}
            </div>`;
    }

    generateAccordion(items) {
        return `
            <div class="accordion">
                ${items.map((item) => `
                    <div class="accordion-item">
                        <button class="accordion-head" data-accordion aria-expanded="false">
                            <span>${escapeHtml(item.title)}</span>
                            <i class="fas fa-chevron-down accordion-chevron"></i>
                        </button>
                        <div class="accordion-panel"><div class="accordion-panel-inner">${escapeHtml(item.content || '')}</div></div>
                    </div>`).join('')}
            </div>`;
    }

    generateCodeGroup(items) {
        const id = this.nextId('cg');
        return `
            <div class="multi-tech-examples code-group">
                <div class="tech-tabs">
                    ${items.map((item, i) => `<button class="tech-tab${i === 0 ? ' active' : ''}" data-target="${id}-${i}">${escapeHtml(item.label || item.language || `Tab ${i + 1}`)}</button>`).join('')}
                </div>
                <div class="tech-examples-content">
                    ${items.map((item, i) => `
                        <div class="tech-example${i === 0 ? ' active' : ''}" id="${id}-${i}">
                            <pre><code class="language-${escapeAttr(item.language || 'text')}">${escapeHtml(codeText(item))}</code></pre>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    generateFields(fields) {
        return `
            <div class="fields-list">
                ${fields.map((field) => `
                    <div class="field-item">
                        <div class="field-head">
                            <code class="field-name">${escapeHtml(field.name)}</code>
                            ${field.type ? `<span class="field-type">${escapeHtml(field.type)}</span>` : ''}
                            ${field.required ? `<span class="field-required">${escapeHtml(this.t('required', 'requerido'))}</span>` : `<span class="field-optional">${escapeHtml(this.t('optional', 'opcional'))}</span>`}
                            ${field.default !== undefined ? `<span class="field-default">default: ${escapeHtml(field.default)}</span>` : ''}
                        </div>
                        ${field.description ? `<div class="field-desc">${escapeHtml(field.description)}</div>` : ''}
                    </div>`).join('')}
            </div>`;
    }

    generateCodeBlock(code) {
        const language = code.language || 'text';
        const isPlainText = String(language).toLowerCase() === 'text';
        const title = code.title || (isPlainText ? '' : this.languageLabel(language));
        return `
            <div class="code-block">
                ${title ? `<div class="code-title"><span>${escapeHtml(title)}</span></div>` : ''}
                <pre><code class="language-${escapeAttr(language)}">${escapeHtml(codeText(code))}</code></pre>
            </div>`;
    }

    languageLabel(language) {
        return LANGUAGE_LABELS[String(language).toLowerCase()] || language;
    }

    generateFeaturesSection(features) {
        return `
            <div class="features-section">
                <div class="features-header">
                    <h2 class="features-title">${escapeHtml(features.title || '')}</h2>
                    <p class="features-subtitle">${escapeHtml(features.subtitle || '')}</p>
                </div>
                <div class="features-grid">
                    ${features.items.map((feature) => `
                        <div class="feature-item">
                            <div class="feature-icon"><i class="${escapeAttr(feature.icon || 'fas fa-circle')}"></i></div>
                            <div class="feature-content">
                                <h4 class="feature-title">${escapeHtml(feature.title)}</h4>
                                <p class="feature-description">${escapeHtml(feature.description || '')}</p>
                                ${feature.link ? `<a href="${escapeAttr(feature.link)}" class="feature-link">${escapeHtml(this.t('explore', 'Explorar'))} →</a>` : ''}
                            </div>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    generateStepsSection(steps) {
        return `
            <div class="steps-section">
                <div class="steps-header">
                    <h2 class="steps-title">${escapeHtml(steps.title || '')}</h2>
                    <p class="steps-subtitle">${escapeHtml(steps.subtitle || '')}</p>
                </div>
                ${this.generateSteps(steps.items)}
            </div>`;
    }

    generateQuickStartSection(quickStart) {
        return `
            <div class="quick-start-section">
                <div class="quick-start-header">
                    <h2 class="quick-start-title">${escapeHtml(quickStart.title || '')}</h2>
                    <p class="quick-start-subtitle">${escapeHtml(quickStart.subtitle || '')}</p>
                </div>
                <div class="quick-start-content">
                    <div class="quick-start-example">
                        ${quickStart.code ? this.generateCodeBlock(quickStart.code) : ''}
                        ${quickStart.response ? `<div class="quick-start-response">${this.generateCodeBlock(quickStart.response)}</div>` : ''}
                    </div>
                </div>
            </div>`;
    }

    renderEndpoint(endpoint) {
        const { title, description, request, responses } = endpoint;
        return `
            <div class="endpoint-page" data-toc-exclude="true">
                <header class="endpoint-head">
                    <h1 class="endpoint-title">${escapeHtml(title)}</h1>
                    ${description ? `<p class="endpoint-summary">${escapeHtml(description)}</p>` : ''}
                    ${this.generateApiBar(endpoint)}
                    ${this.generatePlayground(endpoint)}
                </header>
                <div class="endpoint-grid">
                    <div class="endpoint-prose">
                        ${request ? this.generateRequestSection(request) : ''}
                        ${responses ? this.generateResponseSection(responses) : ''}
                    </div>
                    <aside class="endpoint-examples">
                        ${this.generateRequestExamplePanel(endpoint)}
                        ${this.generateResponseExamplePanel(endpoint)}
                    </aside>
                </div>
            </div>`;
    }

    renderEndpointPlaceholder(navEntry) {
        return `
            <div class="content-section">
                <div class="section-header">
                    <h2 class="section-title">${escapeHtml(navEntry.title)}</h2>
                    <p class="section-subtitle">${escapeHtml(navEntry.method || '')} ${escapeHtml(navEntry.path || '')}</p>
                </div>
                <div class="note-box">${escapeHtml(this.t('endpoint_pending', 'La documentación detallada de este endpoint estará disponible pronto.'))}</div>
            </div>`;
    }

    generateApiBar(endpoint) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const segments = (endpoint.path || '').split('/').filter(Boolean).map((segment) => {
            const isParam = /^\{.+\}$/.test(segment);
            return `<span class="api-path-sep">/</span><span class="api-path-seg${isParam ? ' api-path-param' : ''}">${escapeHtml(segment)}</span>`;
        }).join('');
        return `
            <div class="api-bar">
                <span class="method-badge method-${escapeAttr(method.toLowerCase())}">${escapeHtml(method)}</span>
                <div class="api-path">${segments || '<span class="api-path-seg">/</span>'}</div>
                <button class="api-try" type="button" data-playground-toggle>
                    ${escapeHtml(this.t('try_it', 'Pruébalo'))}
                    <i class="fas fa-play"></i>
                </button>
            </div>`;
    }

    baseUrl() {
        return (this.spec.api && this.spec.api.base_url) || '';
    }

    generateRequestExamplePanel(endpoint) {
        const raw = (endpoint.code_examples || []).filter((example) => codeText(example));
        const examples = raw.length
            ? raw.map((example) => ({
                label: example.name || example.tech || example.language || 'Código',
                language: example.language || 'text',
                code: codeText(example)
            }))
            : [{ label: 'cURL', language: 'bash', code: this.buildCurlExample(endpoint) }];
        const id = this.nextId('reqx');
        return this.generateCodePanel(id, examples.map((example, i) => ({
            tabClass: '',
            label: example.label,
            language: example.language,
            code: example.code,
            index: i
        })));
    }

    generateResponseExamplePanel(endpoint) {
        if (!endpoint.responses) return '';
        const entries = Object.entries(endpoint.responses).map(([status, response]) => {
            let value = null;
            if (response.examples) {
                const first = response.examples.success || Object.values(response.examples)[0];
                if (first) value = first.value;
            }
            const code = value != null
                ? JSON.stringify(value, null, 2)
                : (response.schema ? this.generateSchemaExample(response.schema) : '{}');
            return { status, code };
        });
        if (!entries.length) return '';
        const id = this.nextId('resx');
        return this.generateCodePanel(id, entries.map((entry, i) => ({
            tabClass: ` code-panel-status ${this.statusClass(entry.status)}`,
            label: entry.status,
            language: 'json',
            code: entry.code,
            index: i
        })));
    }

    generateCodePanel(id, items) {
        return `
            <div class="code-panel">
                <div class="code-panel-head">
                    <div class="code-panel-tabs">
                        ${items.map((item) => `<button class="code-panel-tab${item.tabClass}${item.index === 0 ? ' active' : ''}" type="button" data-panel-target="${id}-${item.index}">${escapeHtml(item.label)}</button>`).join('')}
                    </div>
                    <button class="code-panel-copy" type="button" aria-label="${escapeAttr(this.t('copy_code', 'Copiar código'))}"><i class="fas fa-copy"></i></button>
                </div>
                ${items.map((item) => `
                    <div class="code-panel-body${item.index === 0 ? ' active' : ''}" id="${id}-${item.index}">
                        <pre class="code-block code-panel-pre"><code class="language-${escapeAttr(item.language)}">${escapeHtml(item.code)}</code></pre>
                    </div>`).join('')}
            </div>`;
    }

    buildCurlExample(endpoint) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const request = endpoint.request || {};
        const lines = [`curl -X ${method} ${this.baseUrl()}${endpoint.path || ''}`];
        (request.headers || []).forEach((header) => lines.push(`  -H "${header.name}: ${header.value || ''}"`));
        if (request.body && request.body.schema) lines.push(`  -d '${this.generateSchemaExample(request.body.schema)}'`);
        return lines.join(' \\\n');
    }

    statusClass(status) {
        const code = parseInt(status, 10);
        if (code >= 500) return 'status-5xx';
        if (code >= 400) return 'status-4xx';
        if (code >= 300) return 'status-3xx';
        return 'status-2xx';
    }

    generatePlayground(endpoint) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const request = endpoint.request || {};
        const headers = request.headers || [];
        const params = request.query_params || [];
        const bodySchema = request.body && request.body.schema;
        const bodyExample = bodySchema ? this.generateSchemaExample(bodySchema) : '';
        const fullUrl = this.baseUrl() + (endpoint.path || '');
        return `
            <div class="playground" hidden data-method="${escapeAttr(method)}" data-base="${escapeAttr(this.baseUrl())}" data-path="${escapeAttr(endpoint.path || '')}">
                <div class="playground-head">
                    <code class="playground-url">${escapeHtml(fullUrl)}</code>
                    <button class="playground-send" type="button">${escapeHtml(this.t('send', 'Enviar'))} <i class="fas fa-paper-plane"></i></button>
                </div>
                ${headers.length ? `<div class="playground-group">
                    <div class="playground-group-title">Headers</div>
                    ${headers.map((header) => `
                        <div class="playground-field">
                            <label>${escapeHtml(header.name)}</label>
                            <input class="playground-input" data-kind="header" data-name="${escapeAttr(header.name)}" value="${escapeAttr(header.value || '')}" placeholder="${escapeAttr(header.description || '')}" spellcheck="false">
                        </div>`).join('')}
                </div>` : ''}
                ${params.length ? `<div class="playground-group">
                    <div class="playground-group-title">Query params</div>
                    ${params.map((param) => `
                        <div class="playground-field">
                            <label>${escapeHtml(param.name)}${param.required ? ' <span class="playground-req">*</span>' : ''}</label>
                            <input class="playground-input" data-kind="query" data-name="${escapeAttr(param.name)}" value="${escapeAttr(param.example || '')}" placeholder="${escapeAttr(param.type || '')}" spellcheck="false">
                        </div>`).join('')}
                </div>` : ''}
                ${bodySchema ? `<div class="playground-group">
                    <div class="playground-group-title">Body</div>
                    <textarea class="playground-body" data-kind="body" rows="7" spellcheck="false">${escapeHtml(bodyExample)}</textarea>
                </div>` : ''}
                <div class="playground-response" hidden>
                    <div class="playground-response-head">
                        <span class="playground-status"></span>
                        <span class="playground-time"></span>
                    </div>
                    <pre class="playground-response-pre"><code class="language-json playground-response-body"></code></pre>
                </div>
                <div class="playground-note"><i class="fas fa-circle-info"></i> ${escapeHtml(this.t('playground_note', 'El navegador ejecuta la petición real. El servidor debe permitir CORS para responder desde el navegador.'))}</div>
            </div>`;
    }

    generateRequestSection(request) {
        let out = '';
        if (Array.isArray(request.headers) && request.headers.length) {
            out += this.generateProseBlock(this.t('authorizations_title', 'Autorización'), this.generateFieldRows(request.headers.map((header) => ({
                name: header.name, type: 'string', badge: 'header', required: !!header.required, description: header.description || '', example: header.value
            }))));
        }
        if (Array.isArray(request.query_params) && request.query_params.length) {
            out += this.generateProseBlock(this.t('query_params_title', 'Parámetros de consulta'), this.generateFieldRows(request.query_params.map((param) => ({
                name: param.name, type: param.type || 'string', badge: 'query', required: !!param.required, description: param.description || '', example: param.example, default: param.default
            }))));
        }
        const schema = request.body && request.body.schema;
        if (schema && schema.properties) {
            const requiredList = schema.required || [];
            out += this.generateProseBlock(
                this.t('body_title', 'Cuerpo'),
                this.generateFieldRows(Object.entries(schema.properties).map(([name, prop]) => ({
                    name, type: prop.type || 'string', required: requiredList.includes(name), description: prop.description || '', example: prop.example
                }))),
                '<span class="prose-heading-chip">application/json</span>'
            );
        }
        return out;
    }

    generateProseBlock(title, inner, headExtra = '') {
        return `
            <section class="prose-block">
                <h2 class="prose-heading">${escapeHtml(title)}${headExtra}</h2>
                ${inner}
            </section>`;
    }

    generateFieldRows(fields) {
        return `
            <div class="fields-list fields-plain">
                ${fields.map((field) => `
                    <div class="field-item">
                        <div class="field-head">
                            <code class="field-name">${escapeHtml(field.name)}</code>
                            ${field.type ? `<span class="field-chip">${escapeHtml(field.type)}</span>` : ''}
                            ${field.badge ? `<span class="field-chip">${escapeHtml(field.badge)}</span>` : ''}
                            ${field.default !== undefined ? `<span class="field-chip">default: ${escapeHtml(field.default)}</span>` : ''}
                            ${field.required ? `<span class="field-chip field-chip-required">${escapeHtml(this.t('required', 'requerido'))}</span>` : ''}
                        </div>
                        ${field.description ? `<div class="field-desc">${escapeHtml(field.description)}</div>` : ''}
                        ${field.example !== undefined && field.example !== '' ? `<div class="field-example">${escapeHtml(this.t('example', 'Ejemplo'))}: <code>${escapeHtml(typeof field.example === 'object' ? JSON.stringify(field.example) : field.example)}</code></div>` : ''}
                    </div>`).join('')}
            </div>`;
    }

    generateResponseSection(responses) {
        const rows = Object.entries(responses).map(([status, response]) => `
            <div class="response-row">
                <span class="status-chip ${this.statusClass(status)}">${escapeHtml(status)}</span>
                <span class="response-desc">${escapeHtml(response.description || '')}</span>
            </div>`).join('');
        return this.generateProseBlock(this.t('responses_title', 'Respuestas'), `<div class="response-list">${rows}</div>`);
    }

    generateSchemaExample(schema) {
        if (!schema || !schema.properties) return '{}';
        const example = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
            if (prop.example !== undefined) example[key] = prop.example;
            else if (prop.type === 'object' && prop.properties) example[key] = this.generateObjectExample(prop.properties);
            else example[key] = this.defaultValueForType(prop.type);
        }
        return JSON.stringify(example, null, 2);
    }

    generateObjectExample(properties) {
        const out = {};
        for (const [key, prop] of Object.entries(properties)) {
            out[key] = prop.example !== undefined ? prop.example : this.defaultValueForType(prop.type);
        }
        return out;
    }

    defaultValueForType(type) {
        switch (type) {
            case 'string': return 'string';
            case 'number':
            case 'integer': return 0;
            case 'boolean': return true;
            case 'array': return [];
            case 'object': return {};
            default: return null;
        }
    }

    generateSidebar() {
        let html = '';
        if (this.spec.navigation) {
            html += `
                <div class="sidebar-section" data-group="nav_guides">
                    <h6 class="sidebar-title">${escapeHtml(this.t('nav_guides', 'Guías'))}</h6>
                    <nav class="sidebar-nav"><ul>
                        ${this.spec.navigation.map((item) => `
                            <li class="sidebar-nav-item">
                                <a href="#${escapeAttr(item.id)}" class="sidebar-nav-link">
                                    ${item.icon ? `<i class="${escapeAttr(item.icon)}"></i>` : ''}
                                    ${escapeHtml(item.title)}
                                </a>
                            </li>`).join('')}
                    </ul></nav>
                </div>`;
        }
        (this.spec.sections || []).forEach((section) => {
            const items = [];
            (section.pages || []).forEach((page) => {
                items.push(`
                    <li class="sidebar-nav-item">
                        <a href="#${escapeAttr(page.id)}" class="sidebar-nav-link">
                            ${page.icon ? `<i class="${escapeAttr(page.icon)}"></i>` : ''}
                            ${escapeHtml(page.title)}
                        </a>
                    </li>`);
            });
            (section.endpoints || []).forEach((endpoint) => {
                const lead = endpoint.method
                    ? `<span class="method-badge method-${escapeAttr(endpoint.method.toLowerCase())}">${escapeHtml(endpoint.method)}</span>`
                    : (endpoint.icon ? `<i class="${escapeAttr(endpoint.icon)}"></i>` : '');
                items.push(`
                    <li class="sidebar-nav-item">
                        <a href="#${escapeAttr(endpoint.id)}" class="sidebar-nav-link">${lead} ${escapeHtml(endpoint.title)}</a>
                    </li>`);
            });
            if (!items.length) return;
            html += `
                <div class="sidebar-section" data-group="${escapeAttr(section.title)}">
                    <h6 class="sidebar-title">${escapeHtml(section.title)}</h6>
                    <nav class="sidebar-nav"><ul>${items.join('')}</ul></nav>
                </div>`;
        });
        return html;
    }

    renderNavbarTabs(container) {
        if (!container) return;
        const tabs = (this.site.navbar && this.site.navbar.tabs) || [];
        if (tabs.length < 2) {
            document.body.classList.remove('has-tabs');
            container.innerHTML = '';
            this.tabs = null;
            return;
        }
        this.tabs = tabs;
        this.tabsContainer = container;
        document.body.classList.add('has-tabs');
        container.innerHTML = tabs.map((tab, index) => `
            <button type="button" class="navbar-tab" data-tab-index="${index}">
                ${tab.icon ? `<i class="${escapeAttr(tab.icon)}"></i>` : ''}
                ${escapeHtml(tab.text)}
            </button>`).join('');
        container.querySelectorAll('.navbar-tab').forEach((button) => {
            button.addEventListener('click', () => this.applyTab(parseInt(button.getAttribute('data-tab-index'), 10)));
        });
    }

    applyTab(index) {
        if (!this.tabs || !this.tabs[index]) return;
        const groups = this.tabs[index].groups || [];
        document.querySelectorAll('.sidebar-section').forEach((section) => {
            section.style.display = groups.includes(section.getAttribute('data-group')) ? '' : 'none';
        });
        this.tabsContainer.querySelectorAll('.navbar-tab').forEach((button, i) => button.classList.toggle('active', i === index));
    }

    syncTabs(route) {
        if (!this.tabs) return;
        const group = this.groupMap[route];
        const found = this.tabs.findIndex((tab) => (tab.groups || []).includes(group));
        this.applyTab(found >= 0 ? found : 0);
    }

    generateEnvironmentBanner() {
        const warning = this.site.warning_message || {};
        return `
            <div class="endpoint-banner">
                <div class="endpoint-banner-content">
                    <div class="endpoint-banner-icon"><i class="fas fa-cloud"></i></div>
                    <div class="endpoint-banner-info">
                        <div class="endpoint-banner-url">
                            <span class="endpoint-label">${escapeHtml(warning.title || this.t('environment', 'Entorno'))}:</span>
                            <code class="endpoint-url-text">${escapeHtml(this.baseUrl())}</code>
                        </div>
                        <div class="endpoint-banner-note">
                            <i class="fas fa-info-circle"></i>
                            <span>${escapeHtml(warning.content || '')}</span>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    generateFeedback(pageId) {
        return `
            <div class="feedback" data-route="${escapeAttr(pageId)}">
                <span class="feedback-q">${escapeHtml(this.t('feedback_q', '¿Te resultó útil esta página?'))}</span>
                <div class="feedback-actions">
                    <button class="feedback-btn" type="button" data-feedback="up" aria-label="${escapeAttr(this.t('feedback_yes', 'Sí, útil'))}"><i class="fas fa-thumbs-up"></i></button>
                    <button class="feedback-btn" type="button" data-feedback="down" aria-label="${escapeAttr(this.t('feedback_no', 'No útil'))}"><i class="fas fa-thumbs-down"></i></button>
                    <button class="feedback-btn feedback-link" type="button" data-feedback="link"><i class="fas fa-link"></i> ${escapeHtml(this.t('copy_link', 'Copiar enlace'))}</button>
                </div>
            </div>`;
    }

    generateBreadcrumb(pageId) {
        let group = this.t('nav_guides', 'Guías');
        (this.spec.sections || []).forEach((section) => {
            const inPages = (section.pages || []).some((page) => page.id === pageId);
            const inEndpoints = (section.endpoints || []).some((endpoint) => endpoint.id === pageId);
            if (inPages || inEndpoints) group = section.title;
        });
        const current = this.routes.find((route) => route.id === pageId);
        return `
            <div class="page-topbar">
                <nav class="breadcrumb" aria-label="Breadcrumb">
                    <span class="breadcrumb-item">${escapeHtml(group)}</span>
                    <i class="fas fa-chevron-right breadcrumb-sep"></i>
                    <span class="breadcrumb-current">${escapeHtml(current ? current.title : pageId)}</span>
                </nav>
                <div class="page-actions" data-route="${escapeAttr(pageId)}">
                    <button class="page-actions-btn" type="button" data-page-actions aria-label="${escapeAttr(this.t('page_actions', 'Acciones de página'))}">
                        <i class="fas fa-ellipsis"></i>
                    </button>
                    <div class="page-actions-menu">
                        <button type="button" data-action="copy-md"><i class="fas fa-copy"></i> ${escapeHtml(this.t('copy_md', 'Copiar como Markdown'))}</button>
                        <button type="button" data-action="view-md"><i class="fas fa-file-lines"></i> ${escapeHtml(this.t('view_md', 'Ver Markdown'))}</button>
                        <button type="button" data-action="open-claude"><i class="fas fa-robot"></i> ${escapeHtml(this.t('open_claude', 'Abrir en Claude'))}</button>
                        <button type="button" data-action="open-chatgpt"><i class="fas fa-comment-dots"></i> ${escapeHtml(this.t('open_chatgpt', 'Abrir en ChatGPT'))}</button>
                    </div>
                </div>
            </div>`;
    }

    generatePrevNext(pageId) {
        const index = this.routes.findIndex((route) => route.id === pageId);
        if (index === -1) return '';
        const prev = this.routes[index - 1];
        const next = this.routes[index + 1];
        if (!prev && !next) return '';
        return `
            <nav class="page-nav" aria-label="${escapeAttr(this.t('pages', 'Páginas'))}">
                ${prev ? `<a class="page-nav-link page-nav-prev" href="#${escapeAttr(prev.id)}">
                    <span class="page-nav-dir"><i class="fas fa-arrow-left"></i> ${escapeHtml(this.t('prev', 'Anterior'))}</span>
                    <span class="page-nav-title">${escapeHtml(prev.title)}</span>
                </a>` : '<span class="page-nav-spacer"></span>'}
                ${next ? `<a class="page-nav-link page-nav-next" href="#${escapeAttr(next.id)}">
                    <span class="page-nav-dir">${escapeHtml(this.t('next', 'Siguiente'))} <i class="fas fa-arrow-right"></i></span>
                    <span class="page-nav-title">${escapeHtml(next.title)}</span>
                </a>` : '<span class="page-nav-spacer"></span>'}
            </nav>`;
    }

    generateNotFoundPage(pageId) {
        console.error('Page not found in spec:', pageId);
        return `
            <div class="error-page">
                <div class="error-content">
                    <div class="error-badge"><i class="fas fa-compass"></i></div>
                    <h2 class="error-title">${escapeHtml(this.t('not_found_title', 'No encontramos esta página'))}</h2>
                    <p class="error-desc">${escapeHtml(this.t('not_found_desc', 'Puede que el enlace haya cambiado o ya no exista. Prueba desde el inicio o busca lo que necesitas.'))}</p>
                    <div class="error-actions">
                        <a class="btn btn-primary" href="#home">${escapeHtml(this.t('back_home', 'Volver al inicio'))}</a>
                        <button class="btn btn-outline" data-action="open-search">${escapeHtml(this.t('search_aria', 'Buscar en la documentación'))}</button>
                    </div>
                </div>
            </div>`;
    }

    generateErrorPage() {
        return `
            <div class="error-page">
                <div class="error-content">
                    <div class="error-badge"><i class="fas fa-triangle-exclamation"></i></div>
                    <h2 class="error-title">${escapeHtml(this.t('error_title', 'No pudimos cargar esta página'))}</h2>
                    <p class="error-desc">${escapeHtml(this.t('error_desc', 'Ocurrió un problema al mostrar este contenido. Vuelve a intentarlo en un momento.'))}</p>
                    <div class="error-actions">
                        <a class="btn btn-primary" href="#home">${escapeHtml(this.t('back_home', 'Volver al inicio'))}</a>
                        <button class="btn btn-outline" data-action="open-search">${escapeHtml(this.t('search_aria', 'Buscar en la documentación'))}</button>
                    </div>
                </div>
            </div>`;
    }
}
