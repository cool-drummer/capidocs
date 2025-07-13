class AppInitializer {
    constructor() {
        this.config = null;
        this.modules = {};
    }

    async init() {
        try {
            await this.initializeModules();
            await this.generateDynamicHTML();
            this.setupGlobalEventListeners();
        } catch (error) {
            console.error('App initialization failed:', error);
        }
    }

    async initializeModules() {
        if (window.CapiDocsCore) {
            this.modules.core = initializeCapiDocsCore();
            console.log('Core initialized:', !!window.capiDocsCore);
        }

        await new Promise(resolve => setTimeout(resolve, 50));

        if (window.CapidocsRouter) {
            this.modules.router = new window.CapidocsRouter();
            window.capiDocsRouter = this.modules.router;
        }

        if (window.ContentGenerator) {
            this.modules.contentGenerator = new window.ContentGenerator();
        }

        if (window.DynamicHTML) {
            this.modules.dynamicHTML = new window.DynamicHTML();
        }

        if (window.syntaxHighlighter) {
            this.modules.syntaxHighlighter = window.syntaxHighlighter;
        }

        this.attachModulesToWindow();
    }

    attachModulesToWindow() {
        Object.keys(this.modules).forEach(key => {
            if (!window[key] && this.modules[key]) {
                window[key] = this.modules[key];
            }
        });
    }

    async generateDynamicHTML() {
        if (this.modules.dynamicHTML) {
            try {
                await this.modules.dynamicHTML.generateHTML();
            } catch (error) {
                console.error('HTML generation failed:', error);
            }
        }
    }

    setupGlobalEventListeners() {
        window.addEventListener('load', () => this.onWindowLoad());
        window.addEventListener('resize', this.throttle(() => this.onWindowResize(), 250));
        document.addEventListener('click', (e) => this.handleGlobalClick(e));
    }

    onWindowLoad() {
        if (this.modules.core) {
            this.modules.core.observeContentChanges();
        }
    }

    onWindowResize() {
        if (window.innerWidth > 768) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            
            if (sidebar && overlay) {
                sidebar.classList.remove('open');
                overlay.classList.remove('open');
            }
        }
    }

    handleGlobalClick(e) {
        if (e.target.closest('.sidebar-toggle')) {
            e.preventDefault();
            if (this.modules.core) {
                this.modules.core.toggleSidebar();
            }
        }
    }

    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        const appInitializer = new AppInitializer();
        await appInitializer.init();
        window.appInitializer = appInitializer;
    });
} else {
    (async () => {
        const appInitializer = new AppInitializer();
        await appInitializer.init();
        window.appInitializer = appInitializer;
    })();
}

window.App = AppInitializer;

window.tocUtils = {
    exclude: function(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.setAttribute('data-toc-exclude', 'true');
        });
        
        if (window.tocGenerator) {
            window.tocGenerator.refresh();
        }
    },
    
    include: function(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.removeAttribute('data-toc-exclude');
        });
        
        if (window.tocGenerator) {
            window.tocGenerator.refresh();
        }
    },
    
    debug: function(enabled = true) {
        if (window.tocGenerator) {
            window.tocGenerator.debug(enabled);
        } else {
            if (enabled) {
                document.body.classList.add('toc-debug');
            } else {
                document.body.classList.remove('toc-debug');
            }
        }
    },
    
    getStructure: function() {
        if (window.tocGenerator) {
            return window.tocGenerator.headings.map(heading => ({
                id: heading.id,
                text: heading.textContent.trim(),
                level: parseInt(heading.tagName.substring(1)),
                element: heading
            }));
        }
        return [];
    },
    
    getScrollInfo: function() {
        if (window.tocGenerator) {
            return window.tocGenerator.getScrollInfo();
        }
        return null;
    },
    
    refresh: function() {
        if (window.tocGenerator) {
            window.tocGenerator.refresh();
        }
    },
    
    isVisible: function() {
        const tocSidebar = document.getElementById('toc-sidebar');
        return tocSidebar && tocSidebar.style.display !== 'none';
    }
}; 