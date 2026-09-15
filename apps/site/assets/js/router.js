export class Router {
    constructor({ spec, contentGenerator, mainContent, onRendered }) {
        this.spec = spec;
        this.site = spec.site_config || {};
        this.contentGenerator = contentGenerator;
        this.mainContent = mainContent;
        this.onRendered = onRendered;
        this.routes = new Set(['home']);
        this.currentRoute = null;
        this.collectRoutes();
    }

    collectRoutes() {
        (this.spec.navigation || []).forEach((item) => this.routes.add(item.id));
        (this.spec.sections || []).forEach((section) => {
            (section.pages || []).forEach((page) => this.routes.add(page.id));
            (section.endpoints || []).forEach((endpoint) => this.routes.add(endpoint.id));
        });
        Object.keys(this.spec.pages || {}).forEach((id) => this.routes.add(id));
        Object.keys(this.spec.endpoints || {}).forEach((id) => this.routes.add(id));
    }

    start() {
        window.addEventListener('hashchange', () => this.handleHashChange());
        document.addEventListener('click', (event) => {
            const link = event.target.closest('a[href^="#"]');
            if (!link || link.classList.contains('toc-link') || link.closest('.toc-sidebar')) return;
            const target = link.getAttribute('href').substring(1);
            if (!this.routes.has(target) && document.getElementById(target)) return;
            event.preventDefault();
            this.navigate(target || 'home');
        });
        return this.navigate(this.routeFromHash(), true);
    }

    routeFromHash() {
        return window.location.hash.substring(1) || 'home';
    }

    handleHashChange() {
        const hash = window.location.hash.substring(1);
        if (hash && !this.routes.has(hash) && document.getElementById(hash)) return;
        this.navigate(hash || 'home');
    }

    async navigate(route, replace = false) {
        if (this.currentRoute === route) return;
        const url = '#' + route;
        if (window.location.hash !== url) {
            if (replace) history.replaceState(null, '', url);
            else history.pushState(null, '', url);
        }
        await this.render(route);
    }

    async render(route) {
        if (!this.mainContent) return;
        this.currentRoute = route;
        let html;
        try {
            html = this.routes.has(route)
                ? this.contentGenerator.generatePage(route)
                : this.contentGenerator.generateNotFoundPage(route);
        } catch (error) {
            console.error('Error rendering route:', route, error);
            html = this.contentGenerator.generateErrorPage();
        }
        this.mainContent.innerHTML = html;
        this.updateTitle(route);
        window.scrollTo({ top: 0, behavior: 'auto' });
        if (this.onRendered) await this.onRendered(route, this.mainContent);
    }

    updateTitle(route) {
        const titles = this.site.page_titles || {};
        const base = titles.base_title || this.site.name || 'Documentación';
        const separator = titles.separator || ' - ';
        const pageTitle = (titles.routes || {})[route];
        document.title = pageTitle ? `${pageTitle}${separator}${base}` : base;
    }

    reload() {
        this.contentGenerator.cache.clear();
        return this.render(this.currentRoute || 'home');
    }
}
