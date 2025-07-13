class ContentGenerator {
    constructor() {
        this.config = null;
        this.templates = new Map();
        this.cache = new Map();
        this.initializeTemplates();
    }

    async loadConfig() {
            try {
        const response = await fetch('config/api-spec.json');
            const configText = await response.text();
            this.config = JSON.parse(configText);
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
                            <h2 class="section-title">${title}</h2>
                            <p class="section-subtitle">${description}</p>
                        </div>
                    </div>
                    
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
                    <img src="${siteConfig.logos.hero}" alt="${siteConfig.brand || 'Logo'}" class="hero-logo-img">
                </div>` : '';
            
            return `
                <div class="hero-section">
                    <div class="hero-content">
                        ${heroLogoHtml}
                        <h1 class="hero-title">${hero.title}</h1>
                        <p class="hero-subtitle">${hero.subtitle}</p>
                        
                        ${hero.description ? `<p class="hero-description">${hero.description}</p>` : ''}
                        ${hero.base_url ? `<div class="url-base"><strong>URL Base:</strong> <code>${hero.base_url}</code></div>` : ''}
                        ${hero.note ? `<div class="note-box">${hero.note}</div>` : ''}
                        ${hero.audience ? `<div class="audience-box"><strong>Audiencia:</strong> ${hero.audience}</div>` : ''}
                        ${hero.confidentiality ? `<div class="warning-box"><strong>Confidencialidad:</strong> ${hero.confidentiality}</div>` : ''}
                        
                        ${hero.stats ? `
                            <div class="hero-stats">
                                ${hero.stats.map(stat => `
                                    <div class="stat-item">
                                        <span class="stat-number">${stat.number}</span>
                                        <span class="stat-label">${stat.label}</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        
                        ${hero.buttons ? `
                            <div class="hero-buttons">
                                ${hero.buttons.map(btn => `
                                    <a href="${btn.href}" class="btn btn-${btn.type} btn-large">
                                        <i class="${btn.icon}"></i>
                                        ${btn.text}
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
                        <h1 class="page-title">${title}</h1>
                        ${description ? `<p class="page-description">${description}</p>` : ''}
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
                        <h2 class="section-title">${section.title}</h2>
                    </div>
                </div>
                
                ${section.content ? `<div class="section-content">${section.content}</div>` : ''}
                ${section.note ? `<div class="note-box">${section.note}</div>` : ''}
                ${section.warning ? `<div class="warning-box">${section.warning}</div>` : ''}
                
                ${section.list ? `
                    <ul class="content-list">
                        ${section.list.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                ` : ''}
                
                ${section.table ? `
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    ${section.table.headers.map(header => `<th>${header}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${section.table.rows.map(row => `
                                    <tr>
                                        ${row.map(cell => `<td>${cell}</td>`).join('')}
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
                                <div class="step-number">${step.number}</div>
                                <div class="step-content">
                                    <h4>${step.title}</h4>
                                    <p>${step.description}</p>
                                    ${step.link ? `<a href="${step.link}" class="step-link">Ver más →</a>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    generateCodeBlock(code) {
        const language = code.language || 'text';
        const content = code.content || '';
        const title = code.title || '';
        
        return `
            <div class="code-block">
                ${title ? `<div class="code-title">${title}</div>` : ''}
                <pre class="line-numbers"><code class="language-${language}">${this.escapeHtml(content)}</code></pre>
                ${!title ? `<button class="copy-button" onclick="copyToClipboard(this)"><i class="fas fa-copy"></i></button>` : ''}
            </div>
        `;
    }

    generateMultiTechExamples(examples) {
        if (!examples || !Array.isArray(examples)) return '';
        
        const tabsHtml = examples.map((example, index) => `
            <button class="tech-tab ${index === 0 ? 'active' : ''}" 
                    onclick="showTechExample('${example.id}', '${example.tech}')" 
                    data-tech="${example.tech}">
                <i class="${this.getTechIcon(example.tech)}"></i>
                ${example.name}
            </button>
        `).join('');
        
        const contentHtml = examples.map((example, index) => `
            <div class="tech-example ${index === 0 ? 'active' : ''}" 
                 id="example-${example.id}" 
                 data-tech="${example.tech}">
                <div class="example-header">
                    <h4>${example.title}</h4>
                    <p>${example.description}</p>
                </div>
                <div class="code-block">
                    <pre class="line-numbers"><code class="language-${example.language}">${this.escapeHtml(example.code)}</code></pre>
                </div>
                ${example.response ? `
                    <div class="response-example">
                        <h5>Response</h5>
                        <div class="code-block">
                            <pre class="line-numbers"><code class="language-json">${this.escapeHtml(example.response)}</code></pre>
                        </div>
                    </div>
                ` : ''}
            </div>
        `).join('');
        
        return `
            <div class="multi-tech-examples">
                <div class="tech-tabs">
                    ${tabsHtml}
                </div>
                <div class="tech-content">
                    ${contentHtml}
                </div>
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
        div.textContent = text;
        return div.innerHTML;
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
                                    <td><code>${header.name}</code></td>
                                    <td><code>${header.value}</code></td>
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
                <h4>HTTP ${status} - ${response.description}</h4>
                
                ${response.examples ? `
                    <div class="response-examples">
                        <div class="example-tabs">
                            ${Object.entries(response.examples).map(([key, example]) => `
                                <button class="example-tab" onclick="showExample('${status}', '${key}')" data-example="${key}">
                                    ${example.summary}
                                </button>
                            `).join('')}
                        </div>
                        
                        ${Object.entries(response.examples).map(([key, example]) => `
                            <div class="example-content" id="example-${status}-${key}" style="display: ${key === 'success' ? 'block' : 'none'}">
                                <div class="code-block ${key === 'error' ? 'error-example' : ''}">
                                    <pre><code class="json-code">${JSON.stringify(example.value, null, 2)}</code></pre>

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
                    <h2 class="steps-title">${steps.title}</h2>
                    <p class="steps-subtitle">${steps.subtitle}</p>
                </div>
                
                <div class="steps-list">
                    ${steps.items.map(step => `
                        <div class="step-item">
                            <div class="step-number">${step.number}</div>
                            <div class="step-content">
                                <h4>${step.title}</h4>
                                <p>${step.description}</p>
                                ${step.duration ? `<span class="step-duration">⏱️ ${step.duration}</span>` : ''}
                                ${step.link ? `<a href="${step.link}" class="step-link">Ver más →</a>` : ''}
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
                    <h2 class="features-title">${features.title}</h2>
                    <p class="features-subtitle">${features.subtitle}</p>
                </div>
                
                <div class="features-grid">
                    ${features.items.map(feature => `
                        <div class="feature-item">
                            <div class="feature-icon">
                                <i class="${feature.icon}"></i>
                            </div>
                            <div class="feature-content">
                                <h4 class="feature-title">${feature.title}</h4>
                                <p class="feature-description">${feature.description}</p>
                                ${feature.link ? `<a href="${feature.link}" class="feature-link">Explorar →</a>` : ''}
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
                    <h2 class="quick-start-title">${quickStart.title}</h2>
                    <p class="quick-start-subtitle">${quickStart.subtitle}</p>
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
                    <h6 class="sidebar-title">Guías</h6>
                    <nav class="sidebar-nav">
                        <ul>
                            ${this.config.navigation.map(item => `
                                <li class="sidebar-nav-item">
                                    <a href="#${item.id}" class="sidebar-nav-link">
                                        <i class="${item.icon}"></i>
                                        ${item.title}
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
                            <h6 class="sidebar-title">${section.title}</h6>
                            <nav class="sidebar-nav">
                                <ul>
                                    ${section.endpoints.map(endpoint => `
                                        <li class="sidebar-nav-item">
                                            <a href="#${endpoint.id}" class="sidebar-nav-link">
                                                ${endpoint.method ? `<span class="method-badge method-${endpoint.method.toLowerCase()}">${endpoint.method}</span>` : `<i class="${endpoint.icon}"></i>`}
                                                ${endpoint.title}
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
                            <span class="endpoint-label">${envLabel}:</span>
                            <code class="endpoint-url-text">${baseUrl}</code>
                           
                        </div>
                        <div class="endpoint-banner-note">
                            <i class="fas fa-info-circle"></i>
                            <span>${envNote}</span>
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
                                <h2 class="section-title">${foundEndpoint.title}</h2>
                                <p class="section-subtitle">Endpoint: ${foundEndpoint.method} ${foundEndpoint.path}</p>
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
        
        if (pageId !== 'inicio') {
            content = endpointCard + content;
        }
        
        this.cache.set(pageId, content);
        return content;
    }

    generateNotFoundPage(pageId) {
        return `
            <div class="error-page">
                <h2>Page Not Found</h2>
                <p>The page "${pageId}" could not be found in the configuration.</p>
                <a href="#inicio" class="btn btn-primary">Go to Home</a>
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
                inicio: {
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
                    onclick="showTechExample('${example.id}', this)" 
                    data-tech="${example.tech}">
                <i class="fas ${this.getTechIcon(example.tech)}"></i>
                ${example.name}
            </button>
        `).join('');
        
        const examplesHtml = examples.map((example, index) => `
            <div class="tech-example ${index === 0 ? 'active' : ''}" 
                 id="${example.id}"
                 data-tech="${example.tech}">
                <div class="example-header">
                    <h4>${example.title}</h4>
                    <p>${example.description}</p>
                </div>
                <pre class="line-numbers"><code class="language-${example.language}">${this.escapeHtml(example.code)}</code></pre>
            </div>
        `).join('');
        
        return `
                <h3>Ejemplos de Implementación</h3>
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

window.ContentGenerator = ContentGenerator; 