class CapidocsRouter {
    constructor() {
        this.routes = new Map();
        this.currentRoute = null;
        this.mainContent = document.getElementById('main-content');
        this.contentGenerator = null;
        this.siteConfig = null;
        
        this.init();
    }

    async init() {
        try {
            await this.loadSiteConfig();
            await this.setupRoutes();
            await this.initializeContentGenerator();
            this.setupEventListeners();
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            this.handleInitialRoute();
        } catch (error) {
            console.error('Router initialization failed:', error);
            this.showInitializationError(error);
        }
    }

    async loadSiteConfig() {
        try {
            const config = await window.configLoader.load();
            this.siteConfig = config.site_config || {};
        } catch (error) {
            console.error('Failed to load site config:', error);
            this.siteConfig = {};
        }
    }

    async initializeContentGenerator() {
        if (window.ContentGenerator) {
            this.contentGenerator = new window.ContentGenerator();
            try {
                await this.contentGenerator.setupWithRouter(this);
            } catch (error) {
                console.error('Content generator setup failed:', error);
            }
        }
    }

    async setupRoutes() {
        this.routes.clear();
        
        try {
            const config = await window.configLoader.load();

            this.routes.set('home', () => this.generatePageContent('home'));
            
            if (config.navigation) {
                config.navigation.forEach(navItem => {
                    if (navItem.type === 'page' && navItem.id !== 'home') {
                        this.routes.set(navItem.id, () => this.generatePageContent(navItem.id));
                    }
                });
            }
            
            if (config.sections) {
                config.sections.forEach(section => {
                    if (section.pages) {
                        section.pages.forEach(page => {
                            this.routes.set(page.id, () => this.generatePageContent(page.id));
                        });
                    }
                    
                    if (section.endpoints) {
                        section.endpoints.forEach(endpoint => {
                            this.routes.set(endpoint.id, () => this.generatePageContent(endpoint.id));
                        });
                    }
                });
            }
            
        } catch (error) {
            this.routes.set('home', () => this.generatePageContent('home'));
        }
    }

    async generatePageContent(pageId) {
        if (this.contentGenerator) {
            return await this.contentGenerator.generatePage(pageId);
        }
        
        return this.generateFallbackContent(pageId);
    }

    generateFallbackContent(pageId) {
        console.error('Content generator unavailable for page:', pageId);
        return `
            <div class="error-page">
                <div class="error-content">
                    <div class="error-badge"><i class="fas fa-triangle-exclamation"></i></div>
                    <h2 class="error-title">No pudimos cargar esta página</h2>
                    <p class="error-desc">Ocurrió un problema al mostrar este contenido. Vuelve a intentarlo en un momento.</p>
                    <div class="error-actions">
                        <button class="btn btn-primary" onclick="location.reload()">Volver a intentar</button>
                        <a class="btn btn-outline" href="#home">Volver al inicio</a>
                    </div>
                    <p class="error-hint">Los detalles técnicos se registraron en la consola.</p>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        window.addEventListener('hashchange', () => this.handleRouteChange());

        document.addEventListener('click', (e) => {
            const searchTrigger = e.target.closest('[data-action="open-search"]');
            if (searchTrigger) {
                e.preventDefault();
                if (window.capiDocsSearch && typeof window.capiDocsSearch.open === 'function') {
                    window.capiDocsSearch.open();
                }
                return;
            }

            const link = e.target.closest('a[href^="#"]');
            if (link) {
                if (link.classList.contains('toc-link')) {
                    return;
                }
                
                if (link.closest('.toc-sidebar')) {
                    return;
                }
                
                e.preventDefault();
                const route = link.getAttribute('href').substring(1);
                this.navigate(route);
            }
        });
    }

    handleInitialRoute() {
        const hash = window.location.hash.substring(1);
        const route = hash || 'home';
        this.navigate(route, true);
    }

    async navigate(route, replace = false) {
        if (this.currentRoute === route) return;
        
        if (replace) {
            history.replaceState(null, null, `#${route}`);
        } else {
            history.pushState(null, null, `#${route}`);
        }
        
        await this.loadRoute(route);
        this.updateActiveNavigation(route);
        this.updatePageTitle(route);
    }

    async loadRoute(route) {
        if (!this.mainContent) return;
        
        this.currentRoute = route;
        this.showLoading();
        
        try {
            const handler = this.routes.get(route);
            
            let content;
            if (handler) {
                content = await handler();
            } else {
                content = this.generate404Content(route);
            }
            
            this.mainContent.innerHTML = content;
            this.hideLoading();
            
            await this.postRouteLoad();
            
        } catch (error) {
            console.error('Error loading route:', route, error);
            this.mainContent.innerHTML = this.generateErrorContent(error);
            this.hideLoading();
        }
    }

    async postRouteLoad() {
        try {
            this.updateActiveNavigation(this.currentRoute);
            
            
            if (window.tocGenerator && typeof window.tocGenerator.refresh === 'function') {
                window.tocGenerator.refresh();
            }
            
            this.scrollToTop();
            
            
            if (window.capiDocsCore && typeof window.capiDocsCore.initializeCopyButtons === 'function') {
                window.capiDocsCore.initializeCopyButtons();
            }
            
                    
        if (window.syntaxHighlighter && typeof window.syntaxHighlighter.highlightAllInContainer === 'function') {
            window.syntaxHighlighter.highlightAllInContainer();
        }
        
        
        if (typeof window.forceSyntaxHighlighting === 'function') {
            setTimeout(window.forceSyntaxHighlighting, 100);
        }
            
        } catch (error) {
            console.error('Post-route load error:', error);
        }
    }

    showLoading() {
        this.mainContent.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i></div>';
    }

    hideLoading() {
        
    }

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (this.mainContent && typeof this.mainContent.scrollTo === 'function') {
            this.mainContent.scrollTo({ top: 0, behavior: 'auto' });
        }
    }

    updateActiveNavigation(route) {
        try {
            if (window.capiDocsCore && typeof window.capiDocsCore.updateActiveNavigation === 'function') {
                window.capiDocsCore.updateActiveNavigation(route);
            } else {
                
                this.updateNavigationFallback(route);
            }
        } catch (error) {
            console.error('Error updating navigation:', error);
            
            this.updateNavigationFallback(route);
        }
    }

    updateNavigationFallback(route) {
        
        const sidebarLinks = document.querySelectorAll('.sidebar-nav-link, .nav-link, .sidebar a[href^="#"]');
        sidebarLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === `#${route}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        
        const navbarLinks = document.querySelectorAll('.navbar-nav a[href^="#"]');
        navbarLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === `#${route}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    updatePageTitle(route) {
        if (!this.siteConfig || !this.siteConfig.page_titles) {
            document.title = 'API Documentation';
            return;
        }

        const titleConfig = this.siteConfig.page_titles;
        const baseTitle = titleConfig.base_title || 'API Documentation';
        const separator = titleConfig.separator || ' - ';
        const routes = titleConfig.routes || {};
        
        const pageTitle = routes[route];
        if (pageTitle) {
            document.title = `${pageTitle}${separator}${baseTitle}`;
        } else {
            document.title = baseTitle;
        }
    }

    generate404Content(route) {
        console.error('Route not found:', route);
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

    generateErrorContent(error) {
        console.error('Error rendering page content:', error);
        return `
            <div class="error-page">
                <div class="error-content">
                    <div class="error-badge"><i class="fas fa-triangle-exclamation"></i></div>
                    <h2 class="error-title">No pudimos cargar esta página</h2>
                    <p class="error-desc">Ocurrió un problema al mostrar este contenido. Vuelve a intentarlo en un momento.</p>
                    <div class="error-actions">
                        <a class="btn btn-primary" href="#home">Volver al inicio</a>
                        <button class="btn btn-outline" data-action="open-search">Buscar en la documentación</button>
                    </div>
                    <p class="error-hint">Los detalles técnicos se registraron en la consola.</p>
                </div>
            </div>
        `;
    }

    showInitializationError(error) {
        console.error('Documentation initialization error:', error);
        if (this.mainContent) {
            this.mainContent.innerHTML = `
                <div class="error-page">
                    <div class="error-content">
                        <div class="error-badge"><i class="fas fa-triangle-exclamation"></i></div>
                        <h2 class="error-title">No pudimos cargar esta página</h2>
                        <p class="error-desc">Ocurrió un problema al mostrar este contenido. Vuelve a intentarlo en un momento.</p>
                        <div class="error-actions">
                            <button class="btn btn-primary" onclick="location.reload()">Volver a intentar</button>
                        </div>
                        <p class="error-hint">Los detalles técnicos se registraron en la consola.</p>
                    </div>
                </div>
            `;
        }
    }

    handleRouteChange() {
        const hash = window.location.hash.substring(1);
        const route = hash || 'home';

        if (hash && document.getElementById(hash)) {
            return;
        }
        
        this.navigate(route);
    }

    getCurrentRoute() {
        return this.currentRoute;
    }

    getRoutes() {
        return Array.from(this.routes.keys());
    }

    reload() {
        this.loadRoute(this.currentRoute);
    }
}

window.CapidocsRouter = CapidocsRouter; 