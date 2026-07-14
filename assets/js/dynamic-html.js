class DynamicHTMLGenerator {
    constructor() {
        this.config = null;
    }

    async init() {
        try {
            await this.loadConfig();
            await this.generateDynamicContent();
        } catch (error) {
            console.error('Dynamic HTML generation failed:', error);
            this.loadFallbackContent();
        }
    }

    async loadConfig() {
        this.config = await window.configLoader.load();
    }

    async generateDynamicContent() {
        if (!this.config) return;

        document.documentElement.lang = (this.config.site_config && this.config.site_config.lang) || 'es';
        this.generateMetaTags();
        this.generateNavbar();
        this.generateFooter();
        this.updateTocHeader();
        this.applyTheme();
    }

    ui(key, fallback) {
        const ui = (this.config && this.config.site_config && this.config.site_config.ui) || {};
        return ui[key] != null ? ui[key] : fallback;
    }

    updateTocHeader() {
        const tocHeading = document.querySelector('.toc-header h6');
        if (tocHeading) {
            tocHeading.textContent = this.ui('on_this_page', 'En esta página');
        }
    }

    generateMetaTags() {
        const siteConfig = this.config.site_config || {};
        const api = this.config.api || {};

        if (siteConfig.page_titles?.base_title) {
            document.title = siteConfig.page_titles.base_title;
        }

        if (siteConfig.use_logos && siteConfig.logos?.icon) {
            this.updateFavicon(siteConfig.logos.icon);
        } else {
            this.removeFavicon();
        }

        if (api.description) {
            const metaDescription = document.querySelector('meta[name="description"]');
            if (metaDescription) {
                metaDescription.setAttribute('content', api.description);
            }
        }

        if (api.name) {
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle) {
                ogTitle.setAttribute('content', `${api.name} Documentation`);
            }
        }

        if (api.description) {
            const ogDescription = document.querySelector('meta[property="og:description"]');
            if (ogDescription) {
                ogDescription.setAttribute('content', api.description);
            }
        }

        if (api.name) {
            const metaKeywords = document.querySelector('meta[name="keywords"]');
            if (metaKeywords) {
                const currentKeywords = metaKeywords.getAttribute('content');
                const apiKeywords = `${api.name}, API documentation, ${api.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ', ')}`;
                metaKeywords.setAttribute('content', `${apiKeywords}, ${currentKeywords}`);
            }
        }

        if (siteConfig.brand) {
            const metaAuthor = document.querySelector('meta[name="author"]');
            if (metaAuthor) {
                metaAuthor.setAttribute('content', siteConfig.brand);
            }
        }
    }

    generateNavbar() {
        const siteConfig = this.config.site_config || {};
        
        this.updateNavbarBrand(siteConfig);
        
        this.updateNavbarLinks(siteConfig);
    }

    updateNavbarBrand(siteConfig) {
        const navbarBrand = document.querySelector('.navbar-brand');
        if (!navbarBrand) return;

        const usingLogos = !!(siteConfig.use_logos && siteConfig.logos);

        if (usingLogos) {
            this.setupLogoElements(navbarBrand, siteConfig);
        } else {
            this.setupIconElements(navbarBrand, siteConfig);
        }

        const brandName = navbarBrand.querySelector('span:not(.brand-badge), .brand-text');
        const brandBadge = navbarBrand.querySelector('.brand-badge');

        // When a logo already carries the wordmark, drop the redundant name + badge
        // so the navbar reads clean (Mintlify-style).
        if (usingLogos) {
            if (brandName) brandName.remove();
            if (brandBadge) brandBadge.remove();
            return;
        }

        if (brandName && siteConfig.name) {
            brandName.textContent = siteConfig.name;
        }
        if (brandBadge && siteConfig.brand) {
            brandBadge.textContent = siteConfig.brand;
        }
    }

    setupLogoElements(navbarBrand, siteConfig) {
        let logoImg = navbarBrand.querySelector('.navbar-logo');
        if (!logoImg) {
            logoImg = document.createElement('img');
            logoImg.className = 'navbar-logo';
            logoImg.alt = siteConfig.brand || 'Logo';
            
            const iconElement = navbarBrand.querySelector('i');
            if (iconElement) {
                navbarBrand.replaceChild(logoImg, iconElement);
            } else {
                navbarBrand.prepend(logoImg);
            }
        }

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const logoSrc = currentTheme === 'dark' ? siteConfig.logos.navbar_dark : siteConfig.logos.navbar_light;
        
        if (logoSrc) {
            logoImg.src = logoSrc;
        }

        this.observeThemeChanges(logoImg, siteConfig.logos);
    }

    setupIconElements(navbarBrand, siteConfig) {
        this.cleanupLogoElements(navbarBrand);
        
        let iconElement = navbarBrand.querySelector('i');
        if (!iconElement) {
            iconElement = document.createElement('i');
            navbarBrand.prepend(iconElement);
        }
        
        if (siteConfig.brand_icon) {
            iconElement.className = siteConfig.brand_icon;
        }
    }

    cleanupLogoElements(navbarBrand) {
        const existingLogo = navbarBrand.querySelector('.navbar-logo');
        if (existingLogo) {
            existingLogo.remove();
        }
    }

    observeThemeChanges(logoImg, logos) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    const currentTheme = document.documentElement.getAttribute('data-theme');
                    const logoSrc = currentTheme === 'dark' ? logos.navbar_dark : logos.navbar_light;
                    if (logoSrc) {
                        logoImg.src = logoSrc;
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    updateFavicon(iconPath) {
        let favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = iconPath;
    }

    removeFavicon() {
        const favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (favicon) {
            favicon.remove();
        }
    }

    updateNavbarLinks(siteConfig) {
        const navbarNav = document.getElementById('navbar-nav');
        if (!navbarNav) return;

        const themeToggle = navbarNav.querySelector('.theme-toggle');
        
        navbarNav.innerHTML = '';

        if (siteConfig.navbar?.links) {
            siteConfig.navbar.links.forEach(link => {
                const linkElement = document.createElement('a');
                linkElement.href = link.href;
                linkElement.className = 'nav-link';
                linkElement.textContent = link.text;
                
                if (link.icon) {
                    const icon = document.createElement('i');
                    icon.className = link.icon;
                    linkElement.prepend(icon, ' ');
                }
                
                navbarNav.appendChild(linkElement);
            });
        }

        if (themeToggle) {
            navbarNav.appendChild(themeToggle);
        }

        if (siteConfig.navbar?.cta) {
            const cta = siteConfig.navbar.cta;
            const ctaElement = document.createElement('a');
            ctaElement.href = cta.href || '#getting-started';
            ctaElement.className = 'navbar-cta';
            ctaElement.textContent = cta.text || 'Comenzar';
            navbarNav.appendChild(ctaElement);
        }
    }

    generateFooter() {
        const footer = document.querySelector('.footer');
        if (!footer) return;

        const api = this.config.api || {};
        const siteConfig = this.config.site_config || {};
        
        const logoHtml = (siteConfig.use_logos && siteConfig.logos?.footer) ?
            `<img src="${this.escapeAttr(siteConfig.logos.footer)}" alt="${this.escapeAttr(siteConfig.brand || 'Logo')}" class="footer-logo">` :
            '';

        const licenseHtml = siteConfig.license ?
            `<p class="footer-license">${siteConfig.license.link ?
                `<a href="${this.escapeAttr(siteConfig.license.link)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(siteConfig.license.text)}</a>` :
                this.escapeHtml(siteConfig.license.text)}</p>` :
            '';

        footer.innerHTML = `
            <div class="footer-content">
                ${logoHtml}
                <h3 class="footer-title">${this.escapeHtml(api.name || 'Documentación de la API')}</h3>
                <p class="footer-subtitle">${this.escapeHtml(api.description || 'Documentación oficial de la API')}</p>
                ${licenseHtml}
                <div class="footer-bottom">
                    <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(siteConfig.brand || 'API Services')}. ${this.escapeHtml(this.ui('rights', 'Todos los derechos reservados.'))}</p>
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : text;
        return div.innerHTML;
    }

    escapeAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    applyTheme() {
        const siteConfig = this.config.site_config || {};
        const def = siteConfig.default_theme;

        // Respect an explicit user choice.
        if (localStorage.getItem('theme_user_set')) return;

        // 'system' (or unset) → follow the OS preference (core.js already resolved it).
        if (!def || def === 'system' || def === 'auto') return;

        // Explicit 'light'/'dark' default: apply without marking it as a user choice.
        if (window.capiDocsCore && typeof window.capiDocsCore.applyTheme === 'function') {
            window.capiDocsCore.applyTheme(def, false);
        } else {
            document.documentElement.setAttribute('data-theme', def);
        }
    }

    loadFallbackContent() {
        const navbarBrand = document.querySelector('.navbar-brand span:nth-child(2)');
        if (navbarBrand) {
            navbarBrand.textContent = 'API Docs';
        }

        const footer = document.querySelector('.footer');
        if (footer) {
            footer.innerHTML = `
                <div class="footer-content">
                    <h3 class="footer-title">Documentación de la API</h3>
                    <p class="footer-subtitle">Cargando configuración…</p>
                    <p class="footer-license">
                        <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer">
                            Este proyecto es de código abierto y está disponible bajo la licencia MIT.
                        </a>
                    </p>
                    <div class="footer-bottom">
                        <p>&copy; ${new Date().getFullYear()} API Services. Todos los derechos reservados.</p>
                    </div>
                </div>
            `;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const dynamicHTML = new DynamicHTMLGenerator();
    await dynamicHTML.init();
}); 