class ContentGenerator {
    constructor() {
        this.config = null;
        this.templates = new Map();
        this.cache = new Map();
        this.initializeTemplates();
    }

    async loadConfig() {
        try {
            this.config = await window.configLoader.load();
            return this.config;
        } catch (error) {
            console.error('Failed to load configuration:', error);
            this.config = this.getFallbackConfig();
            return this.config;
        }
    }

    initializeTemplates() {
        
        this.templates.set('endpoint', (endpoint) => {
            const { title, description, request, responses } = endpoint;

            return `
                <div class="endpoint-page" data-toc-exclude="true">
                    <header class="endpoint-head">
                        <h1 class="endpoint-title">${this.escapeHtml(title)}</h1>
                        ${description ? `<p class="endpoint-summary">${this.escapeHtml(description)}</p>` : ''}
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
                </div>
            `;
        });

        this.templates.set('hero', (page) => {
            const { hero, features, steps, quick_start, testimonials } = page.content;
            const siteConfig = this.config?.site_config || {};
            
            const heroLogoHtml = (siteConfig.use_logos && siteConfig.logos?.hero) ?
                `<div class="hero-logo">
                    <img src="${this.escapeAttr(siteConfig.logos.hero)}" alt="${this.escapeAttr(siteConfig.brand || 'Logo')}" class="hero-logo-img">
                </div>` : '';

            return `
                <div class="hero-section">
                    <div class="hero-content">
                        ${heroLogoHtml}
                        <h1 class="hero-title">${this.escapeHtml(hero.title)}</h1>
                        <p class="hero-subtitle">${this.escapeHtml(hero.subtitle)}</p>

                        ${hero.description ? `<p class="hero-description">${this.escapeHtml(hero.description)}</p>` : ''}
                        ${hero.base_url ? `<div class="url-base"><strong>URL Base:</strong> <code>${this.escapeHtml(hero.base_url)}</code></div>` : ''}
                        ${hero.note ? `<div class="note-box">${this.escapeHtml(hero.note)}</div>` : ''}
                        ${hero.audience ? `<div class="audience-box"><strong>Audiencia:</strong> ${this.escapeHtml(hero.audience)}</div>` : ''}
                        ${hero.confidentiality ? `<div class="warning-box"><strong>Confidencialidad:</strong> ${this.escapeHtml(hero.confidentiality)}</div>` : ''}

                        ${hero.stats ? `
                            <div class="hero-stats">
                                ${hero.stats.map(stat => `
                                    <div class="stat-item">
                                        <span class="stat-number">${this.escapeHtml(stat.number)}</span>
                                        <span class="stat-label">${this.escapeHtml(stat.label)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}

                        ${hero.buttons ? `
                            <div class="hero-buttons">
                                ${hero.buttons.map(btn => `
                                    <a href="${this.escapeAttr(btn.href)}" class="btn btn-${this.escapeAttr(btn.type)} btn-large">
                                        <i class="${this.escapeAttr(btn.icon)}"></i>
                                        ${this.escapeHtml(btn.text)}
                                    </a>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                ${features ? this.generateFeaturesSection(features) : ''}
                ${steps ? this.generateStepsSection(steps) : ''}
                ${quick_start ? this.generateQuickStartSection(quick_start) : ''}
                <!-- ${testimonials ? this.generateTestimonialsSection(testimonials) : ''} -->
            `;
        });

        this.templates.set('content', (page) => {
            const { title, description, sections } = page.content;
            
            return `
                <div class="content-page">
                    <div class="page-header">
                        <h1 class="page-title">${this.escapeHtml(title)}</h1>
                        ${description ? `<p class="page-description">${this.escapeHtml(description)}</p>` : ''}
                    </div>
                    
                    <div class="page-content">
                        ${sections ? sections.map(section => this.generateContentSection(section)).join('') : ''}
                    </div>
                </div>
            `;
        });
    }

    generateContentSection(section) {
        return `
            <div class="content-section">
                <div class="section-header">
                    <div class="feature-icon">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div>
                        <h2 class="section-title">${this.escapeHtml(section.title)}</h2>
                    </div>
                </div>

                ${section.content ? `<div class="section-content">${this.escapeHtml(section.content)}</div>` : ''}
                ${section.note ? `<div class="note-box">${this.escapeHtml(section.note)}</div>` : ''}
                ${section.warning ? `<div class="warning-box">${this.escapeHtml(section.warning)}</div>` : ''}

                ${section.list ? `
                    <ul class="content-list">
                        ${section.list.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
                    </ul>
                ` : ''}

                ${section.table ? `
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    ${section.table.headers.map(header => `<th>${this.escapeHtml(header)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${section.table.rows.map(row => `
                                    <tr>
                                        ${row.map(cell => `<td>${this.escapeHtml(cell)}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : ''}

                ${section.code ? this.generateCodeBlock(section.code) : ''}

                ${section.steps ? `
                    <div class="steps-list">
                        ${section.steps.map(step => `
                            <div class="step-item">
                                <div class="step-number">${this.escapeHtml(step.number)}</div>
                                <div class="step-content">
                                    <h4>${this.escapeHtml(step.title)}</h4>
                                    <p>${this.escapeHtml(step.description)}</p>
                                    ${step.link ? `<a href="${this.escapeAttr(step.link)}" class="step-link">Ver más →</a>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                ${section.callout ? this.generateCallout(section.callout) : ''}
                ${section.cards ? this.generateCards(section.cards) : ''}
                ${section.tabs ? this.generateTabs(section.tabs) : ''}
                ${section.accordion ? this.generateAccordion(section.accordion) : ''}
                ${section.code_group ? this.generateCodeGroup(section.code_group) : ''}
                ${section.fields ? this.generateFields(section.fields) : ''}
            </div>
        `;
    }

    generateCallout(callout) {
        const types = {
            note:    { icon: 'fa-circle-info',          cls: 'callout-note' },
            info:    { icon: 'fa-circle-info',          cls: 'callout-info' },
            tip:     { icon: 'fa-lightbulb',            cls: 'callout-tip' },
            success: { icon: 'fa-circle-check',         cls: 'callout-success' },
            check:   { icon: 'fa-circle-check',         cls: 'callout-success' },
            warning: { icon: 'fa-triangle-exclamation', cls: 'callout-warning' },
            danger:  { icon: 'fa-circle-exclamation',   cls: 'callout-danger' },
            error:   { icon: 'fa-circle-exclamation',   cls: 'callout-danger' }
        };
        const t = types[String(callout.type || 'note').toLowerCase()] || types.note;
        return `
            <div class="callout ${t.cls}">
                <i class="fas ${t.icon} callout-icon"></i>
                <div class="callout-body">
                    ${callout.title ? `<div class="callout-title">${this.escapeHtml(callout.title)}</div>` : ''}
                    <div class="callout-content">${this.escapeHtml(callout.content || '')}</div>
                </div>
            </div>`;
    }

    generateCards(cards) {
        return `
            <div class="cards-grid">
                ${cards.map(card => {
                    const inner = `
                        ${card.icon ? `<div class="card-icon"><i class="${this.escapeAttr(card.icon)}"></i></div>` : ''}
                        <div class="card-title">${this.escapeHtml(card.title)}</div>
                        ${card.description ? `<div class="card-desc">${this.escapeHtml(card.description)}</div>` : ''}`;
                    return card.link
                        ? `<a class="doc-card doc-card-link" href="${this.escapeAttr(card.link)}">${inner}</a>`
                        : `<div class="doc-card">${inner}</div>`;
                }).join('')}
            </div>`;
    }

    generateTabs(tabs) {
        const id = 'dtabs-' + (this.tabSeq = (this.tabSeq || 0) + 1);
        return `
            <div class="doc-tabs">
                <div class="doc-tabs-nav" role="tablist">
                    ${tabs.map((tab, i) => `
                        <button class="doc-tab${i === 0 ? ' active' : ''}" data-tab-target="${id}-${i}" role="tab" aria-selected="${i === 0}">${this.escapeHtml(tab.label)}</button>
                    `).join('')}
                </div>
                ${tabs.map((tab, i) => `
                    <div class="doc-tab-panel${i === 0 ? ' active' : ''}" id="${id}-${i}" role="tabpanel">
                        ${tab.content ? `<div class="section-content">${this.escapeHtml(tab.content)}</div>` : ''}
                        ${tab.code ? this.generateCodeBlock(tab.code) : ''}
                    </div>
                `).join('')}
            </div>`;
    }

    generateAccordion(items) {
        return `
            <div class="accordion">
                ${items.map(item => `
                    <div class="accordion-item">
                        <button class="accordion-head" data-accordion aria-expanded="false">
                            <span>${this.escapeHtml(item.title)}</span>
                            <i class="fas fa-chevron-down accordion-chevron"></i>
                        </button>
                        <div class="accordion-panel">
                            <div class="accordion-panel-inner">${this.escapeHtml(item.content || '')}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    generateCodeGroup(items) {
        const id = 'cg-' + (this.cgSeq = (this.cgSeq || 0) + 1);
        return `
            <div class="multi-tech-examples code-group">
                <div class="tech-tabs">
                    ${items.map((it, i) => `
                        <button class="tech-tab${i === 0 ? ' active' : ''}" data-target="${id}-${i}">${this.escapeHtml(it.label || it.language || ('Tab ' + (i + 1)))}</button>
                    `).join('')}
                </div>
                <div class="tech-examples-content">
                    ${items.map((it, i) => `
                        <div class="tech-example${i === 0 ? ' active' : ''}" id="${id}-${i}">
                            <pre><code class="language-${this.escapeAttr(it.language || 'text')}">${this.escapeHtml(it.code || it.content || '')}</code></pre>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    generateFields(fields) {
        return `
            <div class="fields-list">
                ${fields.map(f => `
                    <div class="field-item">
                        <div class="field-head">
                            <code class="field-name">${this.escapeHtml(f.name)}</code>
                            ${f.type ? `<span class="field-type">${this.escapeHtml(f.type)}</span>` : ''}
                            ${f.required ? `<span class="field-required">${this.escapeHtml(this.t('required', 'requerido'))}</span>` : `<span class="field-optional">${this.escapeHtml(this.t('optional', 'opcional'))}</span>`}
                            ${f.default !== undefined ? `<span class="field-default">default: ${this.escapeHtml(f.default)}</span>` : ''}
                        </div>
                        ${f.description ? `<div class="field-desc">${this.escapeHtml(f.description)}</div>` : ''}
                    </div>
                `).join('')}
            </div>`;
    }

    generateApiBar(endpoint) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const path = endpoint.path || '';
        const segments = path.split('/').filter(Boolean).map(seg => {
            const isParam = /^\{.+\}$/.test(seg);
            return `<span class="api-path-sep">/</span><span class="api-path-seg${isParam ? ' api-path-param' : ''}">${this.escapeHtml(seg)}</span>`;
        }).join('');

        return `
            <div class="api-bar">
                <span class="method-badge method-${this.escapeAttr(method.toLowerCase())}">${this.escapeHtml(method)}</span>
                <div class="api-path">${segments || '<span class="api-path-seg">/</span>'}</div>
                <button class="api-try" type="button" data-playground-toggle>
                    ${this.escapeHtml(this.t('try_it', 'Pruébalo'))}
                    <i class="fas fa-play"></i>
                </button>
            </div>`;
    }

    generateRequestExamplePanel(endpoint) {
        const baseUrl = (this.config && this.config.api && this.config.api.base_url) || '';
        const raw = (endpoint.code_examples || []).filter(ex => ex.code || ex.content);
        const examples = raw.length
            ? raw.map(ex => ({
                label: ex.name || ex.tech || ex.language || 'Código',
                language: ex.language || 'text',
                code: ex.code || ex.content || ''
            }))
            : [{ label: 'cURL', language: 'bash', code: this.buildCurlExample(endpoint, baseUrl) }];

        const id = 'reqx-' + (this.panelSeq = (this.panelSeq || 0) + 1);
        return `
            <div class="code-panel">
                <div class="code-panel-head">
                    <div class="code-panel-tabs">
                        ${examples.map((ex, i) => `
                            <button class="code-panel-tab${i === 0 ? ' active' : ''}" type="button" data-panel-target="${id}-${i}">${this.escapeHtml(ex.label)}</button>
                        `).join('')}
                    </div>
                    <button class="code-panel-copy" type="button" aria-label="${this.escapeAttr(this.t('copy_code', 'Copiar código'))}"><i class="fas fa-copy"></i></button>
                </div>
                ${examples.map((ex, i) => `
                    <div class="code-panel-body${i === 0 ? ' active' : ''}" id="${id}-${i}">
                        <pre class="code-block code-panel-pre"><code class="language-${this.escapeAttr(ex.language)}">${this.escapeHtml(ex.code)}</code></pre>
                    </div>
                `).join('')}
            </div>`;
    }

    generateResponseExamplePanel(endpoint) {
        const responses = endpoint.responses;
        if (!responses) return '';

        const entries = Object.entries(responses).map(([status, response]) => {
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

        const id = 'resx-' + (this.panelSeq = (this.panelSeq || 0) + 1);
        return `
            <div class="code-panel">
                <div class="code-panel-head">
                    <div class="code-panel-tabs">
                        ${entries.map((en, i) => `
                            <button class="code-panel-tab code-panel-status ${this.statusClass(en.status)}${i === 0 ? ' active' : ''}" type="button" data-panel-target="${id}-${i}">${this.escapeHtml(en.status)}</button>
                        `).join('')}
                    </div>
                    <button class="code-panel-copy" type="button" aria-label="${this.escapeAttr(this.t('copy_code', 'Copiar código'))}"><i class="fas fa-copy"></i></button>
                </div>
                ${entries.map((en, i) => `
                    <div class="code-panel-body${i === 0 ? ' active' : ''}" id="${id}-${i}">
                        <pre class="code-block code-panel-pre"><code class="language-json">${this.escapeHtml(en.code)}</code></pre>
                    </div>
                `).join('')}
            </div>`;
    }

    buildCurlExample(endpoint, baseUrl) {
        const method = String(endpoint.method || 'GET').toUpperCase();
        const req = endpoint.request || {};
        const lines = [`curl -X ${method} ${baseUrl}${endpoint.path || ''}`];
        (req.headers || []).forEach(h => lines.push(`  -H "${h.name}: ${h.value || ''}"`));
        if (req.body && req.body.schema) {
            lines.push(`  -d '${this.generateSchemaExample(req.body.schema)}'`);
        }
        return lines.join(' \\\n');
    }

    statusClass(status) {
        const n = parseInt(status, 10);
        if (n >= 500) return 'status-5xx';
        if (n >= 400) return 'status-4xx';
        if (n >= 300) return 'status-3xx';
        return 'status-2xx';
    }

    generatePlayground(endpoint) {
        const baseUrl = (this.config.api && this.config.api.base_url) || '';
        const method = String(endpoint.method || 'GET').toUpperCase();
        const req = endpoint.request || {};
        const headers = req.headers || [];
        const params = req.query_params || [];
        const bodySchema = req.body && req.body.schema;
        const bodyExample = bodySchema ? this.generateSchemaExample(bodySchema) : '';
        const fullUrl = baseUrl + (endpoint.path || '');

        return `
            <div class="playground" hidden data-method="${this.escapeAttr(method)}" data-base="${this.escapeAttr(baseUrl)}" data-path="${this.escapeAttr(endpoint.path || '')}">
                <div class="playground-head">
                    <code class="playground-url">${this.escapeHtml(fullUrl)}</code>
                    <button class="playground-send" type="button">Enviar <i class="fas fa-paper-plane"></i></button>
                </div>
                ${headers.length ? `<div class="playground-group">
                    <div class="playground-group-title">Headers</div>
                    ${headers.map(h => `
                        <div class="playground-field">
                            <label>${this.escapeHtml(h.name)}</label>
                            <input class="playground-input" data-kind="header" data-name="${this.escapeAttr(h.name)}" value="${this.escapeAttr(h.value || '')}" placeholder="${this.escapeAttr(h.description || '')}" spellcheck="false">
                        </div>`).join('')}
                </div>` : ''}
                ${params.length ? `<div class="playground-group">
                    <div class="playground-group-title">Query params</div>
                    ${params.map(p => `
                        <div class="playground-field">
                            <label>${this.escapeHtml(p.name)}${p.required ? ' <span class="playground-req">*</span>' : ''}</label>
                            <input class="playground-input" data-kind="query" data-name="${this.escapeAttr(p.name)}" value="${this.escapeAttr(p.example || '')}" placeholder="${this.escapeAttr(p.type || '')}" spellcheck="false">
                        </div>`).join('')}
                </div>` : ''}
                ${bodySchema ? `<div class="playground-group">
                    <div class="playground-group-title">Body</div>
                    <textarea class="playground-body" data-kind="body" rows="7" spellcheck="false">${this.escapeHtml(bodyExample)}</textarea>
                </div>` : ''}
                <div class="playground-response" hidden>
                    <div class="playground-response-head">
                        <span class="playground-status"></span>
                        <span class="playground-time"></span>
                    </div>
                    <pre class="playground-response-pre"><code class="language-json playground-response-body"></code></pre>
                </div>
                <div class="playground-note"><i class="fas fa-circle-info"></i> El navegador ejecuta la petición real. El servidor debe permitir CORS para responder desde el navegador.</div>
            </div>`;
    }

    generateCodeBlock(code) {
        const language = code.language || 'text';
        const content = code.content || '';
        const isPlainText = String(language).toLowerCase() === 'text';
        const title = code.title || (isPlainText ? '' : this.languageLabel(language));

        return `
            <div class="code-block">
                ${title ? `<div class="code-title"><span>${this.escapeHtml(title)}</span></div>` : ''}
                <pre><code class="language-${this.escapeAttr(language)}">${this.escapeHtml(content)}</code></pre>
            </div>
        `;
    }

    languageLabel(language) {
        const labels = {
            bash: 'Terminal',
            sh: 'Terminal',
            shell: 'Terminal',
            curl: 'cURL',
            javascript: 'JavaScript',
            js: 'JavaScript',
            typescript: 'TypeScript',
            ts: 'TypeScript',
            python: 'Python',
            json: 'JSON',
            yaml: 'YAML',
            html: 'HTML',
            css: 'CSS',
            php: 'PHP',
            go: 'Go',
            ruby: 'Ruby',
            java: 'Java',
            text: 'Texto'
        };
        return labels[String(language).toLowerCase()] || language;
    }

    getTechIcon(tech) {
        const icons = {
            // languages
            'curl': 'fas fa-terminal',
            'bash': 'fas fa-terminal',
            'javascript': 'fab fa-js-square',
            'js': 'fab fa-js-square',
            'python': 'fab fa-python',
            'php': 'fab fa-php',
            'java': 'fab fa-java',
            'csharp': 'fab fa-microsoft',
            'c#': 'fab fa-microsoft',
            'ruby': 'fab fa-gem',
            'go': 'fas fa-rocket',
            'golang': 'fas fa-rocket',
            'node': 'fab fa-node-js',
            'nodejs': 'fab fa-node-js',
            'typescript': 'fab fa-js-square',
            'ts': 'fab fa-js-square',
            
            // framworks and toosl
            'react': 'fab fa-react',
            'vue': 'fab fa-vuejs',
            'angular': 'fab fa-angular',
            'express': 'fab fa-node-js',
            'django': 'fab fa-python',
            'flask': 'fab fa-python',
            'laravel': 'fab fa-php',
            'spring': 'fab fa-java',
            
            // platforms
            'postman': 'fas fa-paper-plane',
            'insomnia': 'fas fa-bed',
            'rest': 'fas fa-network-wired',
            'api': 'fas fa-server',
            'http': 'fas fa-globe-americas',
            'https': 'fas fa-shield-alt',
            
            'default': 'fas fa-laptop-code'
        };
        
        const techLower = tech.toLowerCase().trim();
        return icons[techLower] || icons['default'];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : text;
        return div.innerHTML;
    }

    t(key, fallback) {
        const ui = (this.config && this.config.site_config && this.config.site_config.ui) || {};
        return ui[key] != null ? ui[key] : fallback;
    }

    escapeAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    generateRequestSection(request) {
        if (!request) return '';
        let out = '';

        if (Array.isArray(request.headers) && request.headers.length) {
            const fields = request.headers.map(h => ({
                name: h.name,
                type: 'string',
                badge: 'header',
                required: !!h.required,
                description: h.description || '',
                example: h.value
            }));
            out += this.generateProseBlock(this.t('authorizations_title', 'Autorización'), this.generateFieldRows(fields));
        }

        if (Array.isArray(request.query_params) && request.query_params.length) {
            const fields = request.query_params.map(p => ({
                name: p.name,
                type: p.type || 'string',
                badge: 'query',
                required: !!p.required,
                description: p.description || '',
                example: p.example,
                default: p.default
            }));
            out += this.generateProseBlock(this.t('query_params_title', 'Parámetros de consulta'), this.generateFieldRows(fields));
        }

        const schema = request.body && request.body.schema;
        if (schema && schema.properties) {
            const requiredList = schema.required || [];
            const fields = Object.entries(schema.properties).map(([name, prop]) => ({
                name,
                type: prop.type || 'string',
                required: requiredList.includes(name),
                description: prop.description || '',
                example: prop.example
            }));
            out += this.generateProseBlock(
                this.t('body_title', 'Cuerpo'),
                this.generateFieldRows(fields),
                '<span class="prose-heading-chip">application/json</span>'
            );
        }

        return out;
    }

    generateProseBlock(title, inner, headExtra) {
        return `
            <section class="prose-block">
                <h2 class="prose-heading">${this.escapeHtml(title)}${headExtra || ''}</h2>
                ${inner}
            </section>`;
    }

    generateFieldRows(fields) {
        return `
            <div class="fields-list fields-plain">
                ${fields.map(f => `
                    <div class="field-item">
                        <div class="field-head">
                            <code class="field-name">${this.escapeHtml(f.name)}</code>
                            ${f.type ? `<span class="field-chip">${this.escapeHtml(f.type)}</span>` : ''}
                            ${f.badge ? `<span class="field-chip">${this.escapeHtml(f.badge)}</span>` : ''}
                            ${f.default !== undefined ? `<span class="field-chip">default: ${this.escapeHtml(f.default)}</span>` : ''}
                            ${f.required ? `<span class="field-chip field-chip-required">${this.escapeHtml(this.t('required', 'requerido'))}</span>` : ''}
                        </div>
                        ${f.description ? `<div class="field-desc">${this.escapeHtml(f.description)}</div>` : ''}
                        ${f.example !== undefined && f.example !== '' ? `
                            <div class="field-example">${this.escapeHtml(this.t('example', 'Ejemplo'))}: <code>${this.escapeHtml(typeof f.example === 'object' ? JSON.stringify(f.example) : f.example)}</code></div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>`;
    }

    generateResponseSection(responses) {
        if (!responses) return '';
        const rows = Object.entries(responses).map(([status, response]) => `
            <div class="response-row">
                <span class="status-chip ${this.statusClass(status)}">${this.escapeHtml(status)}</span>
                <span class="response-desc">${this.escapeHtml(response.description || '')}</span>
            </div>
        `).join('');
        return this.generateProseBlock(this.t('responses_title', 'Respuestas'), `<div class="response-list">${rows}</div>`);
    }

    generateSchemaExample(schema) {
        if (!schema || !schema.properties) return '{}';
        
        const example = {};
        for (const [key, prop] of Object.entries(schema.properties)) {
            if (prop.example !== undefined) {
                example[key] = prop.example;
            } else if (prop.type === 'object' && prop.properties) {
                example[key] = this.generateObjectExample(prop.properties);
            } else {
                example[key] = this.getDefaultValueForType(prop.type);
            }
        }
        
        return JSON.stringify(example, null, 2);
    }

    generateObjectExample(properties) {
        const obj = {};
        for (const [key, prop] of Object.entries(properties)) {
            obj[key] = prop.example !== undefined ? prop.example : this.getDefaultValueForType(prop.type);
        }
        return obj;
    }

    getDefaultValueForType(type) {
        switch (type) {
            case 'string': return 'string';
            case 'number': return 0;
            case 'boolean': return true;
            case 'array': return [];
            case 'object': return {};
            default: return null;
        }
    }

    generateStepsSection(steps) {
        return `
            <div class="steps-section">
                <div class="steps-header">
                    <h2 class="steps-title">${this.escapeHtml(steps.title)}</h2>
                    <p class="steps-subtitle">${this.escapeHtml(steps.subtitle)}</p>
                </div>

                <div class="steps-list">
                    ${steps.items.map(step => `
                        <div class="step-item">
                            <div class="step-number">${this.escapeHtml(step.number)}</div>
                            <div class="step-content">
                                <h4>${this.escapeHtml(step.title)}</h4>
                                <p>${this.escapeHtml(step.description)}</p>
                                ${step.duration ? `<span class="step-duration">⏱️ ${this.escapeHtml(step.duration)}</span>` : ''}
                                ${step.link ? `<a href="${this.escapeAttr(step.link)}" class="step-link">Ver más →</a>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    generateFeaturesSection(features) {
        return `
            <div class="features-section">
                <div class="features-header">
                    <h2 class="features-title">${this.escapeHtml(features.title)}</h2>
                    <p class="features-subtitle">${this.escapeHtml(features.subtitle)}</p>
                </div>

                <div class="features-grid">
                    ${features.items.map(feature => `
                        <div class="feature-item">
                            <div class="feature-icon">
                                <i class="${this.escapeAttr(feature.icon)}"></i>
                            </div>
                            <div class="feature-content">
                                <h4 class="feature-title">${this.escapeHtml(feature.title)}</h4>
                                <p class="feature-description">${this.escapeHtml(feature.description)}</p>
                                ${feature.link ? `<a href="${this.escapeAttr(feature.link)}" class="feature-link">Explorar →</a>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    generateQuickStartSection(quickStart) {
        return `
            <div class="quick-start-section">
                <div class="quick-start-header">
                    <h2 class="quick-start-title">${this.escapeHtml(quickStart.title)}</h2>
                    <p class="quick-start-subtitle">${this.escapeHtml(quickStart.subtitle)}</p>
                </div>
                
                <div class="quick-start-content">
                    <div class="quick-start-example">
                        ${quickStart.code ? this.generateCodeBlock(quickStart.code) : ''}
                        ${quickStart.response ? `
                            <div class="quick-start-response">
                                ${this.generateCodeBlock(quickStart.response)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    generateTestimonialsSection(testimonials) {
        return `
            <div class="testimonials-section">
                <div class="testimonials-header">
                    <h2 class="testimonials-title">${testimonials.title}</h2>
                </div>
                
                <div class="testimonials-grid">
                    ${testimonials.items.map(testimonial => `
                        <div class="testimonial-item">
                            <blockquote class="testimonial-quote">
                                "${testimonial.quote}"
                            </blockquote>
                            <div class="testimonial-author">
                                <div class="author-info">
                                    <div class="author-name">${testimonial.author}</div>
                                    <div class="author-company">${testimonial.company}</div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    generateSidebar() {
        if (!this.config) return '';
        
        let sidebarHTML = '';
        
        // main navigation
        if (this.config.navigation) {
            sidebarHTML += `
                <div class="sidebar-section" data-group="nav_guides">
                    <h6 class="sidebar-title">${this.escapeHtml(this.t('nav_guides', 'Guías'))}</h6>
                    <nav class="sidebar-nav">
                        <ul>
                            ${this.config.navigation.map(item => `
                                <li class="sidebar-nav-item">
                                    <a href="#${this.escapeAttr(item.id)}" class="sidebar-nav-link">
                                        <i class="${this.escapeAttr(item.icon)}"></i>
                                        ${this.escapeHtml(item.title)}
                                    </a>
                                </li>
                            `).join('')}
                        </ul>
                    </nav>
                </div>
            `;
        }
        
        // sections with pages or endpoints
        if (this.config.sections) {
            this.config.sections.forEach(section => {
                const items = [];

                (section.pages || []).forEach(page => {
                    items.push(`
                        <li class="sidebar-nav-item">
                            <a href="#${this.escapeAttr(page.id)}" class="sidebar-nav-link">
                                ${page.icon ? `<i class="${this.escapeAttr(page.icon)}"></i>` : ''}
                                ${this.escapeHtml(page.title)}
                            </a>
                        </li>
                    `);
                });

                (section.endpoints || []).forEach(endpoint => {
                    items.push(`
                        <li class="sidebar-nav-item">
                            <a href="#${this.escapeAttr(endpoint.id)}" class="sidebar-nav-link">
                                ${endpoint.method ? `<span class="method-badge method-${this.escapeAttr(endpoint.method.toLowerCase())}">${this.escapeHtml(endpoint.method)}</span>` : `<i class="${this.escapeAttr(endpoint.icon)}"></i>`}
                                ${this.escapeHtml(endpoint.title)}
                            </a>
                        </li>
                    `);
                });

                if (!items.length) return;

                sidebarHTML += `
                    <div class="sidebar-section" data-group="${this.escapeAttr(section.title)}">
                        <h6 class="sidebar-title">${this.escapeHtml(section.title)}</h6>
                        <nav class="sidebar-nav">
                            <ul>${items.join('')}</ul>
                        </nav>
                    </div>
                `;
            });
        }
        
        return sidebarHTML;
    }

    buildPageGroupMap() {
        const map = {};
        (this.config.navigation || []).forEach(item => { map[item.id] = 'nav_guides'; });
        (this.config.sections || []).forEach(section => {
            (section.endpoints || []).forEach(ep => { map[ep.id] = section.title; });
            (section.pages || []).forEach(pg => { map[pg.id] = section.title; });
        });
        return map;
    }

    renderNavbarTabs() {
        const container = document.getElementById('navbar-tabs');
        if (!container) return;

        const tabs = this.config?.site_config?.navbar?.tabs;
        if (!Array.isArray(tabs) || tabs.length < 2) {
            document.body.classList.remove('has-tabs');
            container.innerHTML = '';
            return;
        }

        this.pageGroupMap = this.buildPageGroupMap();
        document.body.classList.add('has-tabs');

        container.innerHTML = tabs.map((tab, index) => `
            <button type="button" class="navbar-tab" data-tab-index="${index}">
                ${tab.icon ? `<i class="${this.escapeAttr(tab.icon)}"></i>` : ''}
                ${this.escapeHtml(tab.text)}
            </button>
        `).join('');

        const applyTab = (index) => {
            const tab = tabs[index];
            if (!tab) return;
            const groups = tab.groups || [];
            document.querySelectorAll('.sidebar-section').forEach(section => {
                const group = section.getAttribute('data-group');
                section.style.display = groups.includes(group) ? '' : 'none';
            });
            container.querySelectorAll('.navbar-tab').forEach((btn, i) => {
                btn.classList.toggle('active', i === index);
            });
        };

        const tabForRoute = () => {
            const pageId = (window.location.hash || '').replace(/^#/, '') || 'home';
            const group = this.pageGroupMap[pageId];
            const found = tabs.findIndex(t => (t.groups || []).includes(group));
            return found >= 0 ? found : 0;
        };

        container.querySelectorAll('.navbar-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                applyTab(parseInt(btn.getAttribute('data-tab-index'), 10));
            });
        });

        if (!this._tabsHashBound) {
            window.addEventListener('hashchange', () => applyTab(tabForRoute()));
            this._tabsHashBound = true;
        }

        applyTab(tabForRoute());
    }

    generateEndpointCard() {
        const apiConfig = this.config?.api || {};
        const siteConfig = this.config?.site_config || {};
        const baseUrl = apiConfig.base_url || 'https://api.example.com/v1';
        
        const envLabel = siteConfig.warning_message?.title || 'API Environment';
        const envNote = siteConfig.warning_message?.content || 'This environment is available for integration testing purposes.';
        
        return `
            <div class="endpoint-banner">
                <div class="endpoint-banner-content">
                    <div class="endpoint-banner-icon">
                        <i class="fas fa-cloud"></i>
                    </div>
                    <div class="endpoint-banner-info">
                        <div class="endpoint-banner-url">
                            <span class="endpoint-label">${this.escapeHtml(envLabel)}:</span>
                            <code class="endpoint-url-text">${this.escapeHtml(baseUrl)}</code>

                        </div>
                        <div class="endpoint-banner-note">
                            <i class="fas fa-info-circle"></i>
                            <span>${this.escapeHtml(envNote)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async generatePage(pageId) {
        if (!this.config) {
            await this.loadConfig();
        }
        
        if (this.cache.has(pageId)) {
            return this.cache.get(pageId);
        }
        
        let content = '';
        const endpointCard = this.generateEndpointCard();
        
        if (this.config.pages && this.config.pages[pageId]) {
            const page = this.config.pages[pageId];
            const template = this.templates.get(page.template);
            if (template) {
                content = template(page);
            }
        }
        else if (this.config.sections) {
            let foundEndpoint = null;
            
            for (const section of this.config.sections) {
                if (section.endpoints) {
                    const endpoint = section.endpoints.find(ep => ep.id === pageId);
                    if (endpoint) {
                        foundEndpoint = endpoint;
                        break;
                    }
                }
            }
            
            if (foundEndpoint) {
                if (this.config.endpoints && this.config.endpoints[pageId]) {
                    const endpointData = this.config.endpoints[pageId];
                    const template = this.templates.get('endpoint');
                    content = template(endpointData);
                } else {
                    content = `
                        <div class="content-section">
                            <div class="section-header">
                                <h2 class="section-title">${this.escapeHtml(foundEndpoint.title)}</h2>
                                <p class="section-subtitle">Endpoint: ${this.escapeHtml(foundEndpoint.method)} ${this.escapeHtml(foundEndpoint.path)}</p>
                            </div>
                            <div class="note-box">
                                Detailed documentation for this endpoint is coming soon.
                            </div>
                        </div>
                    `;
                }
            }
        }
        
        if (!content) {
            content = this.generateNotFoundPage(pageId);
        }
        
        if (pageId !== 'home') {
            const isEndpointPage = !!(this.config.endpoints && this.config.endpoints[pageId]);
            content = (isEndpointPage ? '' : endpointCard) + this.generateBreadcrumb(pageId) + content + this.generateFeedback(pageId) + this.generatePrevNext(pageId);
        }

        this.cache.set(pageId, content);
        return content;
    }

    generateFeedback(pageId) {
        return `
            <div class="feedback" data-route="${this.escapeAttr(pageId)}">
                <span class="feedback-q">${this.escapeHtml(this.t('feedback_q', '¿Te resultó útil esta página?'))}</span>
                <div class="feedback-actions">
                    <button class="feedback-btn" type="button" data-feedback="up" aria-label="Sí, útil"><i class="fas fa-thumbs-up"></i></button>
                    <button class="feedback-btn" type="button" data-feedback="down" aria-label="No útil"><i class="fas fa-thumbs-down"></i></button>
                    <button class="feedback-btn feedback-link" type="button" data-feedback="link"><i class="fas fa-link"></i> ${this.escapeHtml(this.t('copy_link', 'Copiar enlace'))}</button>
                </div>
            </div>`;
    }

    getOrderedRoutes() {
        const out = [];
        const seen = new Set();
        const push = (id, title) => {
            if (id && !seen.has(id)) { seen.add(id); out.push({ id: id, title: title || id }); }
        };
        (this.config.navigation || []).forEach(n => { if (n.type === 'page' || !n.type) push(n.id, n.title); });
        (this.config.sections || []).forEach(s => {
            (s.pages || []).forEach(p => push(p.id, p.title));
            (s.endpoints || []).forEach(e => push(e.id, e.title));
        });
        return out;
    }

    generateBreadcrumb(pageId) {
        let group = 'Guías';
        (this.config.sections || []).forEach(s => {
            const inPages = (s.pages || []).some(p => p.id === pageId);
            const inEnds = (s.endpoints || []).some(e => e.id === pageId);
            if (inPages || inEnds) group = s.title;
        });
        const cur = this.getOrderedRoutes().find(r => r.id === pageId);
        const title = cur ? cur.title : pageId;
        return `
            <div class="page-topbar">
                <nav class="breadcrumb" aria-label="Breadcrumb">
                    <span class="breadcrumb-item">${this.escapeHtml(group)}</span>
                    <i class="fas fa-chevron-right breadcrumb-sep"></i>
                    <span class="breadcrumb-current">${this.escapeHtml(title)}</span>
                </nav>
                <div class="page-actions" data-route="${this.escapeAttr(pageId)}">
                    <button class="page-actions-btn" type="button" data-page-actions aria-label="Acciones de página">
                        <i class="fas fa-ellipsis"></i>
                    </button>
                    <div class="page-actions-menu">
                        <button type="button" data-action="copy-md"><i class="fas fa-copy"></i> Copiar como Markdown</button>
                        <button type="button" data-action="view-md"><i class="fas fa-file-lines"></i> Ver Markdown</button>
                        <button type="button" data-action="open-claude"><i class="fas fa-robot"></i> Abrir en Claude</button>
                        <button type="button" data-action="open-chatgpt"><i class="fas fa-comment-dots"></i> Abrir en ChatGPT</button>
                    </div>
                </div>
            </div>`;
    }

    generatePrevNext(pageId) {
        const routes = this.getOrderedRoutes();
        const i = routes.findIndex(r => r.id === pageId);
        if (i === -1) return '';
        const prev = routes[i - 1];
        const next = routes[i + 1];
        if (!prev && !next) return '';
        return `
            <nav class="page-nav" aria-label="Páginas">
                ${prev ? `<a class="page-nav-link page-nav-prev" href="#${this.escapeAttr(prev.id)}">
                    <span class="page-nav-dir"><i class="fas fa-arrow-left"></i> ${this.escapeHtml(this.t('prev', 'Anterior'))}</span>
                    <span class="page-nav-title">${this.escapeHtml(prev.title)}</span>
                </a>` : '<span class="page-nav-spacer"></span>'}
                ${next ? `<a class="page-nav-link page-nav-next" href="#${this.escapeAttr(next.id)}">
                    <span class="page-nav-dir">${this.escapeHtml(this.t('next', 'Siguiente'))} <i class="fas fa-arrow-right"></i></span>
                    <span class="page-nav-title">${this.escapeHtml(next.title)}</span>
                </a>` : '<span class="page-nav-spacer"></span>'}
            </nav>`;
    }

    generateNotFoundPage(pageId) {
        console.error('Page not found in configuration:', pageId);
        return `
            <div class="error-page">
                <div class="error-content">
                    <div class="error-badge"><i class="fas fa-compass"></i></div>
                    <h2 class="error-title">No encontramos esta página</h2>
                    <p class="error-desc">Puede que el enlace haya cambiado o ya no exista. Prueba desde el inicio o busca lo que necesitas.</p>
                    <div class="error-actions">
                        <a class="btn btn-primary" href="#home">Volver al inicio</a>
                        <button class="btn btn-outline" data-action="open-search">Buscar en la documentación</button>
                    </div>
                    <p class="error-hint">Los detalles técnicos se registraron en la consola.</p>
                </div>
            </div>
        `;
    }

    getFallbackConfig() {
        return {
            api: {
                name: "Documentación de la API",
                version: "1.0.0"
            },
            pages: {
                home: {
                    template: "hero",
                    content: {
                        hero: {
                            title: "Documentación de la API",
                            subtitle: "Cargando configuración…",
                            stats: []
                        }
                    }
                }
            }
        };
    }

 
    async setupWithRouter(router) {
        try {
            this.router = router;
            await this.loadConfig();
            
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.innerHTML = this.generateSidebar();
            }
            this.renderNavbarTabs();

            console.log('Content generator setup complete');
        } catch (error) {
            console.error('Content generator setup failed:', error);
            this.config = this.getFallbackConfig();
            
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.innerHTML = this.generateSidebar();
            }
            this.renderNavbarTabs();
        }
    }


    clearCache() {
        this.cache.clear();
    }


    async reload() {
        this.clearCache();
        await this.loadConfig();
    }

    generateCodeExamplesSection(examples) {
        if (!examples || !Array.isArray(examples)) return '';
        
        const tabsHtml = examples.map((example, index) => `
            <button class="tech-tab ${index === 0 ? 'active' : ''}"
                    data-target="${this.escapeAttr(example.id)}"
                    data-tech="${this.escapeAttr(example.tech)}">
                <i class="fas ${this.escapeAttr(this.getTechIcon(example.tech))}"></i>
                ${this.escapeHtml(example.name)}
            </button>
        `).join('');

        const examplesHtml = examples.map((example, index) => `
            <div class="tech-example ${index === 0 ? 'active' : ''}"
                 id="${this.escapeAttr(example.id)}"
                 data-tech="${this.escapeAttr(example.tech)}">
                <div class="example-header">
                    <h4>${this.escapeHtml(example.title)}</h4>
                    <p>${this.escapeHtml(example.description)}</p>
                </div>
                <pre><code class="language-${this.escapeAttr(example.language)}">${this.escapeHtml(example.code)}</code></pre>
            </div>
        `).join('');
        
        return `
                <h3>${this.escapeHtml(this.t('code_examples_title', 'Ejemplos de Implementación'))}</h3>
                <div class="multi-tech-examples">
                    <div class="tech-tabs">
                        ${tabsHtml}
                    </div>
                    <div class="tech-examples-content">
                        ${examplesHtml}
                    </div>
                </div>
        `;
    }

    generateModernIcon(type, context = '') {
        const svgIcons = {
            'api': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <circle cx="12" cy="7" r="1" fill="currentColor"/>
                    <circle cx="12" cy="12" r="1" fill="currentColor"/>
                    <circle cx="12" cy="17" r="1" fill="currentColor"/>
                </svg>
            `,
            'security': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L3 7V11C3 16.55 6.84 21.74 12 23C17.16 21.74 21 16.55 21 11V7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="8" r="1" fill="currentColor"/>
                </svg>
            `,
            'data': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" stroke-width="2"/>
                    <path d="M21 12C21 13.66 16.97 15 12 15C7.03 15 3 13.66 3 12" stroke="currentColor" stroke-width="2"/>
                    <path d="M3 5V19C3 20.66 7.03 22 12 22C16.97 22 21 20.66 21 19V5" stroke="currentColor" stroke-width="2"/>
                    <circle cx="12" cy="12" r="1" fill="currentColor"/>
                    <circle cx="8" cy="9" r="0.5" fill="currentColor"/>
                    <circle cx="16" cy="9" r="0.5" fill="currentColor"/>
                </svg>
            `,
            'ai': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.5 2A2.5 2.5 0 0 0 7 4.5V6A4 4 0 0 0 3 10V16A2 2 0 0 0 5 18H7A2 2 0 0 0 9 16V10A4 4 0 0 0 7 6V4.5A2.5 2.5 0 0 0 9.5 2Z" stroke="currentColor" stroke-width="2"/>
                    <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V6A4 4 0 0 1 21 10V16A2 2 0 0 1 19 18H17A2 2 0 0 1 15 16V10A4 4 0 0 1 17 6V4.5A2.5 2.5 0 0 1 14.5 2Z" stroke="currentColor" stroke-width="2"/>
                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                    <path d="M12 8V16" stroke="currentColor" stroke-width="1" opacity="0.5"/>
                </svg>
            `,
            'network': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                    <circle cx="12" cy="1" r="1" fill="currentColor"/>
                    <circle cx="12" cy="23" r="1" fill="currentColor"/>
                    <circle cx="1" cy="12" r="1" fill="currentColor"/>
                    <circle cx="23" cy="12" r="1" fill="currentColor"/>
                    <path d="M12 9V3" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M12 21V15" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M15 12H21" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M3 12H9" stroke="currentColor" stroke-width="1.5"/>
                </svg>
            `,
            'code': `
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 18L22 12L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M8 6L2 12L8 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14 4L10 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="12" cy="12" r="1" fill="currentColor" opacity="0.7"/>
                </svg>
            `
        };

        const icon = svgIcons[type] || svgIcons['code'];
        const categoryClass = this.getIconCategoryClass(type, context);
        
        return `
            <div class="icon-advanced ${categoryClass}">
                ${icon}
            </div>
        `;
    }

    getIconCategoryClass(type, context) {
        const categoryMap = {
            'api': 'icon-tech-api',
            'security': 'icon-tech-security', 
            'data': 'icon-tech-data',
            'ai': 'icon-tech-ai',
            'network': 'icon-tech-api'
        };
        
        if (context && context.includes('security')) return 'icon-tech-security';
        if (context && context.includes('data')) return 'icon-tech-data';
        if (context && context.includes('ai')) return 'icon-tech-ai';
        
        return categoryMap[type] || 'icon-tech-api';
    }

    getModernTechIcon(tech, useAdvanced = false) {
        if (useAdvanced) {
            return this.generateModernIcon(this.mapTechToIconType(tech), tech);
        }
        
        const modernIcons = {
            'curl': 'fas fa-terminal',
            'bash': 'fas fa-terminal', 
            'javascript': 'fab fa-js-square',
            'python': 'fab fa-python',
            'go': 'fas fa-rocket',
            'golang': 'fas fa-rocket',
            'rust': 'fas fa-cog',
            'typescript': 'fab fa-js-square',
            'react': 'fab fa-react',
            'vue': 'fab fa-vuejs',
            'angular': 'fab fa-angular',
            'docker': 'fab fa-docker',
            'kubernetes': 'fas fa-dharmachakra',
            'aws': 'fab fa-aws',
            'azure': 'fab fa-microsoft',
            'gcp': 'fab fa-google',
            'graphql': 'fas fa-project-diagram',
            'redis': 'fas fa-database',
            'mongodb': 'fas fa-leaf',
            'postgresql': 'fas fa-elephant',
            'mysql': 'fas fa-database',
            'api': 'fas fa-server',
            'microservices': 'fas fa-cubes',
            'ml': 'fas fa-brain',
            'ai': 'fas fa-robot',
            'blockchain': 'fas fa-link',
            'iot': 'fas fa-wifi',
            'default': 'fas fa-laptop-code'
        };
        
        const techLower = tech.toLowerCase().trim();
        return modernIcons[techLower] || modernIcons['default'];
    }

    mapTechToIconType(tech) {
        const typeMap = {
            'api': 'api',
            'security': 'security',
            'auth': 'security',
            'authentication': 'security',
            'authorization': 'security',
            'database': 'data',
            'data': 'data',
            'analytics': 'data',
            'ai': 'ai',
            'ml': 'ai',
            'machine-learning': 'ai',
            'neural': 'ai',
            'network': 'network',
            'microservices': 'network',
            'distributed': 'network'
        };
        
        const techLower = tech.toLowerCase();
        for (const [key, value] of Object.entries(typeMap)) {
            if (techLower.includes(key)) return value;
        }
        
        return 'code';
    }
}


window.showExample = function(status, exampleType) {
    const allExamples = document.querySelectorAll(`[id^="example-${status}-"]`);
    allExamples.forEach(example => example.style.display = 'none');
    
    const selectedExample = document.getElementById(`example-${status}-${exampleType}`);
    if (selectedExample) {
        selectedExample.style.display = 'block';
    }
    
    const tabs = document.querySelectorAll('.example-tab');
    tabs.forEach(tab => {
        if (tab.getAttribute('data-example') === exampleType) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
};

window.showTechExample = function(exampleId, tabElement) {
    const container = tabElement.closest('.multi-tech-examples');
    if (!container) return;
    
    const allTabs = container.querySelectorAll('.tech-tab');
    const allExamples = container.querySelectorAll('.tech-example');
    
    allTabs.forEach(tab => tab.classList.remove('active'));
    allExamples.forEach(example => example.classList.remove('active'));
    
    tabElement.classList.add('active');
    const targetExample = document.getElementById(exampleId);
    if (targetExample) {
        targetExample.classList.add('active');

        if (typeof Prism !== 'undefined') {
            Prism.highlightAllUnder(targetExample);
        }
    }
};

document.addEventListener('click', function(event) {
    const tryBtn = event.target.closest('[data-playground-toggle]');
    if (tryBtn) {
        const head = tryBtn.closest('.endpoint-head');
        const pg = head ? head.querySelector('.playground') : null;
        if (pg) {
            pg.hidden = !pg.hidden;
            tryBtn.classList.toggle('open', !pg.hidden);
        }
        return;
    }

    const panelTab = event.target.closest('.code-panel-tab[data-panel-target]');
    if (panelTab) {
        const panel = panelTab.closest('.code-panel');
        if (panel) {
            panel.querySelectorAll('.code-panel-tab').forEach(function (t) { t.classList.remove('active'); });
            panel.querySelectorAll('.code-panel-body').forEach(function (b) { b.classList.remove('active'); });
            panelTab.classList.add('active');
            const body = document.getElementById(panelTab.getAttribute('data-panel-target'));
            if (body) {
                body.classList.add('active');
                if (typeof Prism !== 'undefined') Prism.highlightAllUnder(body);
            }
        }
        return;
    }

    const panelCopy = event.target.closest('.code-panel-copy');
    if (panelCopy) {
        const panel = panelCopy.closest('.code-panel');
        const activeCode = panel ? panel.querySelector('.code-panel-body.active code') : null;
        if (activeCode && navigator.clipboard) {
            navigator.clipboard.writeText(activeCode.textContent).then(function () {
                const icon = panelCopy.querySelector('i');
                if (icon) {
                    icon.className = 'fas fa-check';
                    panelCopy.classList.add('copied');
                    setTimeout(function () {
                        icon.className = 'fas fa-copy';
                        panelCopy.classList.remove('copied');
                    }, 1600);
                }
            }).catch(function () { /* clipboard unavailable */ });
        }
        return;
    }

    const techTab = event.target.closest('.tech-tab[data-target]');
    if (techTab) {
        window.showTechExample(techTab.getAttribute('data-target'), techTab);
        return;
    }

    const exampleTab = event.target.closest('.example-tab[data-status]');
    if (exampleTab) {
        window.showExample(exampleTab.getAttribute('data-status'), exampleTab.getAttribute('data-example'));
        return;
    }

    const docTab = event.target.closest('.doc-tab[data-tab-target]');
    if (docTab) {
        const wrap = docTab.closest('.doc-tabs');
        if (wrap) {
            wrap.querySelectorAll('.doc-tab').forEach(function (t) {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            wrap.querySelectorAll('.doc-tab-panel').forEach(function (p) { p.classList.remove('active'); });
            docTab.classList.add('active');
            docTab.setAttribute('aria-selected', 'true');
            const panel = document.getElementById(docTab.getAttribute('data-tab-target'));
            if (panel) {
                panel.classList.add('active');
                if (typeof Prism !== 'undefined') Prism.highlightAllUnder(panel);
            }
        }
        return;
    }

    const accHead = event.target.closest('.accordion-head[data-accordion]');
    if (accHead) {
        const item = accHead.closest('.accordion-item');
        if (item) {
            const open = item.classList.toggle('open');
            accHead.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }
});

window.ContentGenerator = ContentGenerator;