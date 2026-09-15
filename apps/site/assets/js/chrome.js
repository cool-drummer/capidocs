import { escapeAttr, escapeHtml } from './escape.js';

export class Chrome {
    constructor({ spec, t, resolveAsset }) {
        this.spec = spec;
        this.site = spec.site_config || {};
        this.api = spec.api || {};
        this.t = t;
        this.resolveAsset = resolveAsset;
    }

    render() {
        document.documentElement.lang = this.site.lang || 'es';
        this.renderMeta();
        this.renderBrand();
        this.renderNavLinks();
        this.renderFooter();
        const tocHeading = document.querySelector('.toc-header h6');
        if (tocHeading) tocHeading.textContent = this.t('on_this_page', 'En esta página');
    }

    renderMeta() {
        const titles = this.site.page_titles || {};
        if (titles.base_title) document.title = titles.base_title;

        if (this.site.use_logos && this.site.logos && this.site.logos.icon) this.setFavicon(this.resolveAsset(this.site.logos.icon));

        const setMeta = (selector, value) => {
            const element = document.querySelector(selector);
            if (element && value) element.setAttribute('content', value);
        };
        setMeta('meta[name="description"]', this.api.description);
        setMeta('meta[property="og:description"]', this.api.description);
        setMeta('meta[property="og:title"]', this.api.name ? `${this.api.name} ${this.t('documentation', 'Documentación')}` : '');
        setMeta('meta[name="author"]', this.site.brand);
        if (this.api.name) {
            const keywords = document.querySelector('meta[name="keywords"]');
            if (keywords) keywords.setAttribute('content', `${this.api.name}, API, ${keywords.getAttribute('content') || ''}`);
        }
    }

    setFavicon(href) {
        let favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }
        favicon.href = href;
    }

    renderBrand() {
        const brand = document.querySelector('.navbar-brand');
        if (!brand) return;
        const usingLogos = !!(this.site.use_logos && this.site.logos);
        const name = brand.querySelector('span:not(.brand-badge), .brand-text');
        const badge = brand.querySelector('.brand-badge');

        if (usingLogos) {
            const logo = document.createElement('img');
            logo.className = 'navbar-logo';
            logo.alt = this.site.brand || 'Logo';
            const icon = brand.querySelector('i');
            if (icon) brand.replaceChild(logo, icon);
            else brand.prepend(logo);
            const swap = (theme) => {
                const src = theme === 'dark' ? this.site.logos.navbar_dark : this.site.logos.navbar_light;
                if (src) logo.src = this.resolveAsset(src);
            };
            swap(document.documentElement.getAttribute('data-theme') || 'dark');
            document.addEventListener('capidocs:theme', (event) => swap(event.detail.theme));
            if (name) name.remove();
            if (badge) badge.remove();
            return;
        }

        const icon = brand.querySelector('i') || brand.insertBefore(document.createElement('i'), brand.firstChild);
        if (this.site.brand_icon) icon.className = this.site.brand_icon;
        if (name && this.site.name) name.textContent = this.site.name;
        if (badge && this.site.brand) badge.textContent = this.site.brand;
    }

    renderNavLinks() {
        const nav = document.getElementById('navbar-nav');
        if (!nav) return;
        const themeToggle = nav.querySelector('.theme-toggle');
        nav.innerHTML = '';

        const navbar = this.site.navbar || {};
        (navbar.links || []).forEach((link) => {
            const anchor = document.createElement('a');
            anchor.href = link.href;
            anchor.className = 'nav-link';
            anchor.textContent = link.text;
            if (link.icon) {
                const icon = document.createElement('i');
                icon.className = link.icon;
                anchor.prepend(icon, ' ');
            }
            nav.appendChild(anchor);
        });

        if (themeToggle) nav.appendChild(themeToggle);

        if (navbar.cta) {
            const cta = document.createElement('a');
            cta.href = navbar.cta.href || '#getting-started';
            cta.className = 'navbar-cta';
            cta.textContent = navbar.cta.text || this.t('get_started', 'Comenzar');
            nav.appendChild(cta);
        }
    }

    renderFooter() {
        const footer = document.querySelector('.footer');
        if (!footer) return;
        const logo = this.site.use_logos && this.site.logos && this.site.logos.footer
            ? `<img src="${escapeAttr(this.resolveAsset(this.site.logos.footer))}" alt="${escapeAttr(this.site.brand || 'Logo')}" class="footer-logo">`
            : '';
        const license = this.site.license
            ? `<p class="footer-license">${this.site.license.link
                ? `<a href="${escapeAttr(this.site.license.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(this.site.license.text)}</a>`
                : escapeHtml(this.site.license.text)}</p>`
            : '';
        footer.innerHTML = `
            <div class="footer-content">
                ${logo}
                <h3 class="footer-title">${escapeHtml(this.api.name || this.t('documentation', 'Documentación de la API'))}</h3>
                <p class="footer-subtitle">${escapeHtml(this.api.description || '')}</p>
                ${license}
                <div class="footer-bottom">
                    <p>&copy; ${new Date().getFullYear()} ${escapeHtml(this.site.brand || '')}. ${escapeHtml(this.t('rights', 'Todos los derechos reservados.'))}</p>
                </div>
            </div>`;
    }
}
