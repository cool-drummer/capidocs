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
        const response = await fetch('config/api-spec.json');
        this.config = await response.json();
    }

    async generateDynamicContent() {
        if (!this.config) return;

        this.generateMetaTags();
        this.generateNavbar();
        this.generateFooter();
        this.applyTheme();
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

        if (siteConfig.use_logos && siteConfig.logos) {
            this.setupLogoElements(navbarBrand, siteConfig);
        } else {
            this.setupIconElements(navbarBrand, siteConfig);
        }

        const brandName = navbarBrand.querySelector('span, .brand-text');
        if (brandName && siteConfig.name) {
            brandName.textContent = siteConfig.name;
        }

        const brandBadge = navbarBrand.querySelector('.brand-badge');
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
    }

    generateFooter() {
        const footer = document.querySelector('.footer');
        if (!footer) return;

        const api = this.config.api || {};
        const siteConfig = this.config.site_config || {};
        
        const logoHtml = (siteConfig.use_logos && siteConfig.logos?.footer) ? 
            `<img src="${siteConfig.logos.footer}" alt="${siteConfig.brand || 'Logo'}" class="footer-logo">` : 
            '';

        footer.innerHTML = `
            <div class="footer-content">
                ${logoHtml}
                <h3 class="footer-title">${api.name || 'API Documentation'}</h3>
                <p class="footer-subtitle">${api.description || 'Official API documentation'}</p>
                <div class="footer-bottom">
                    <p>&copy; ${new Date().getFullYear()} ${siteConfig.brand || 'API Services'}. All rights reserved. This documentation contains confidential and proprietary information intended solely for authorized clients and technical personnel. Any unauthorized access, reproduction, distribution, or disclosure is strictly prohibited.</p>
                </div>
            </div>
        `;
    }

    applyTheme() {
        const siteConfig = this.config.site_config || {};
        
        if (siteConfig.default_theme) {
            const currentTheme = localStorage.getItem('theme');
            if (!currentTheme) {
                document.documentElement.setAttribute('data-theme', siteConfig.default_theme);
                localStorage.setItem('theme', siteConfig.default_theme);
                
                const themeIcon = document.getElementById('theme-icon');
                const themeText = document.getElementById('theme-text');
                
                if (siteConfig.default_theme === 'dark') {
                    if (themeIcon) themeIcon.className = 'fas fa-sun';
                    if (themeText) themeText.textContent = 'Light';
                } else {
                    if (themeIcon) themeIcon.className = 'fas fa-moon';
                    if (themeText) themeText.textContent = 'Dark';
                }
            }
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
                    <h3 class="footer-title">API Documentation</h3>
                    <p class="footer-subtitle">Loading configuration...</p>
                    <div class="footer-bottom">
                        <p>&copy; ${new Date().getFullYear()} API Services. All rights reserved.</p>
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