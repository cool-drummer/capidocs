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
            const { method, path, title, description, request, responses, code_examples } = endpoint;
            
            return `
                <div class="content-section">
                    <div class="section-header">
                        <div class="feature-icon">
                            <i class="fas fa-laptop-code"></i>
                        </div>
                        <div>
                            <h2 class="section-title">${this.escapeHtml(title)}</h2>
                            <p class="section-subtitle">${this.escapeHtml(description)}</p>
                        </div>
                    </div>

                    ${this.generatePlayground(endpoint)}

                    <div class="endpoint-card">
                        ${request ? this.generateRequestSection(request) : ''}
                        ${responses ? this.generateResponseSection(responses) : ''}
                        ${code_examples ? this.generateCodeExamplesSection(code_examples) : ''}
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
                            <pre class="line-numbers"><code class="language-${this.escapeAttr(it.language || 'text')}">${this.escapeHtml(it.code || it.content || '')}</code></pre>
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
                            ${f.required ? `<span class="field-required">required</span>` : `<span class="field-optional">optional</span>`}
                            ${f.default !== undefined ? `<span class="field-default">default: ${this.escapeHtml(f.default)}</span>` : ''}
                        </div>
                        ${f.description ? `<div class="field-desc">${this.escapeHtml(f.description)}</div>` : ''}
                    </div>
                `).join('')}
            </div>`;
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
            <div class="playground" data-method="${this.escapeAttr(method)}" data-base="${this.escapeAttr(baseUrl)}" data-path="${this.escapeAttr(endpoint.path || '')}">
                <div class="playground-head">
                    <span class="method-badge method-${this.escapeAttr(method.toLowerCase())}">${this.escapeHtml(method)}</span>
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
        const title = code.title || '';
        
        return `
            <div class="code-block">
                ${title ? `<div class="code-title">${this.escapeHtml(title)}</div>` : ''}
                <pre class="line-numbers"><code class="language-${this.escapeAttr(language)}">${this.escapeHtml(content)}</code></pre>
            </div>
        `;
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
        
        return `
            <h3 class="request-title">Request</h3>
            
            ${request.headers ? `
                <h4>Headers</h4>
                <div class="table-container">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Header</th>
                                <th>Value</th>
                                <th>Required</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${request.headers.map(header => `
                                <tr>
                                    <td><code>${this.escapeHtml(header.name)}</code></td>
                                    <td><code>${this.escapeHtml(header.value)}</code></td>
                                    <td>${header.required ? '<span class="required-badge">Required</span>' : '<span class="optional-badge">Optional</span>'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            
            ${request.body ? `
                <h4>Body</h4>
                <div class="code-block">
                    <pre><code class="json-code">${this.generateSchemaExample(request.body.schema)}</code></pre>

                </div>
            ` : ''}
        `;
    }

    generateResponseSection(responses) {
        if (!responses) return '';
        
        return `
            <h3>Responses</h3>
            ${Object.entries(responses).map(([status, response]) => `
                <h4>HTTP ${this.escapeHtml(status)} - ${this.escapeHtml(response.description)}</h4>

                ${response.examples ? `
                    <div class="response-examples">
                        <div class="example-tabs">
                            ${Object.entries(response.examples).map(([key, example]) => `
                                <button class="example-tab" data-status="${this.escapeAttr(status)}" data-example="${this.escapeAttr(key)}">
                                    ${this.escapeHtml(example.summary)}
                                </button>
                            `).join('')}
                        </div>

                        ${Object.entries(response.examples).map(([key, example]) => `
                            <div class="example-content" id="example-${this.escapeAttr(status)}-${this.escapeAttr(key)}" style="display: ${key === 'success' ? 'block' : 'none'}">
                                <div class="code-block ${key === 'error' ? 'error-example' : ''}">
                                    <pre><code class="json-code">${this.escapeHtml(JSON.stringify(example.value, null, 2))}</code></pre>

                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div class="code-block">
                        <pre><code class="json-code">${this.generateSchemaExample(response.schema)}</code></pre>

                    </div>
                `}
            `).join('')}
        `;
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
                <div class="sidebar-section">
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
        
        // sections with endpoints
        if (this.config.sections) {
            this.config.sections.forEach(section => {
                if (section.endpoints) {
                    sidebarHTML += `
                        <div class="sidebar-section">
                            <h6 class="sidebar-title">${this.escapeHtml(section.title)}</h6>
                            <nav class="sidebar-nav">
                                <ul>
                                    ${section.endpoints.map(endpoint => `
                                        <li class="sidebar-nav-item">
                                            <a href="#${this.escapeAttr(endpoint.id)}" class="sidebar-nav-link">
                                                ${endpoint.method ? `<span class="method-badge method-${this.escapeAttr(endpoint.method.toLowerCase())}">${this.escapeHtml(endpoint.method)}</span>` : `<i class="${this.escapeAttr(endpoint.icon)}"></i>`}
                                                ${this.escapeHtml(endpoint.title)}
                                            </a>
                                        </li>
                                    `).join('')}
                                </ul>
                            </nav>
                        </div>
                    `;
                }
            });
        }
        
        return sidebarHTML;
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
            content = endpointCard + this.generateBreadcrumb(pageId) + content + this.generateFeedback(pageId) + this.generatePrevNext(pageId);
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
        return `
            <div class="error-page">
                <h2>Page Not Found</h2>
                <p>The page "${this.escapeHtml(pageId)}" could not be found in the configuration.</p>
                <a href="#home" class="btn btn-primary">Go to Home</a>
            </div>
        `;
    }

    getFallbackConfig() {
        return {
            api: {
                name: "API Documentation",
                version: "1.0.0"
            },
            pages: {
                home: {
                    template: "hero",
                    content: {
                        hero: {
                            title: "API Documentation",
                            subtitle: "Loading configuration...",
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
            
            console.log('Content generator setup complete');
        } catch (error) {
            console.error('Content generator setup failed:', error);
            this.config = this.getFallbackConfig();
            
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.innerHTML = this.generateSidebar();
            }
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
                <pre class="line-numbers"><code class="language-${this.escapeAttr(example.language)}">${this.escapeHtml(example.code)}</code></pre>
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