class CapiDocsCore {
    constructor() {
        this.userSetTheme = !!localStorage.getItem('theme_user_set');
        this.currentTheme = this.userSetTheme
            ? (localStorage.getItem('theme') || this.systemTheme())
            : this.systemTheme();
        this.copyAnimationQueue = new Map();
        this.init();
    }

    init() {
        this.applyTheme(this.currentTheme, this.userSetTheme);
        this.watchSystemTheme();
        this.initializeCopyButtons();
        this.setupThemeObserver();
        this.setupCodeBlockObserver();
        this.setupEventListeners();
    }

    systemTheme() {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    watchSystemTheme() {
        if (!window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => {
            if (!localStorage.getItem('theme_user_set')) {
                this.applyTheme(e.matches ? 'dark' : 'light', false);
            }
        };
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
    }

    setupEventListeners() {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', () => this.toggleMobileNav());
        }

        const sidebarOverlay = document.getElementById('sidebar-overlay');
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => this.toggleSidebar());
        }
    }

    sanitizeHTML(htmlString) {
        const temp = document.createElement('div');
        temp.textContent = htmlString;
        return temp.innerHTML;
    }

    setElementContent(element, content, isHTML = false) {
        if (!element) return;
        
        if (isHTML) {
            if (typeof content === 'string' && content.includes('<')) {
                const sanitized = content
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .replace(/on\w+\s*=/gi, '');
                element.innerHTML = sanitized;
            } else {
                element.innerHTML = content;
            }
        } else {
            element.textContent = content;
        }
    }

    createElement(tag, options = {}) {
        const element = document.createElement(tag);
        
        if (options.className) {
            element.className = options.className;
        }
        
        if (options.id) {
            element.id = options.id;
        }
        
        if (options.textContent) {
            element.textContent = options.textContent;
        }
        
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    element.setAttribute(key, value);
                }
            });
        }
        
        return element;
    }

    applyTheme(theme, persist = true) {
        document.documentElement.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        if (persist) {
            localStorage.setItem('theme', theme);
            localStorage.setItem('theme_user_set', '1');
        }
        this.updateThemeButton();
    }

    updateThemeButton() {
        const themeIcon = document.getElementById('theme-icon');
        const themeText = document.getElementById('theme-text');
        
        if (themeIcon && themeText) {
            if (this.currentTheme === 'dark') {
                themeIcon.className = 'fas fa-sun';
                themeText.textContent = 'Claro';
            } else {
                themeIcon.className = 'fas fa-moon';
                themeText.textContent = 'Oscuro';
            }
        }
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        if (sidebar && overlay) {
            const isOpen = sidebar.classList.contains('open');
            
            if (isOpen) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            } else {
                sidebar.classList.add('open');
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        }
    }

    toggleMobileNav() {
        const navbarNav = document.getElementById('navbar-nav');
        if (navbarNav) {
            navbarNav.classList.toggle('active');
        }
    }

    initializeCopyButtons() {
        this.addCopyButtonsToExistingBlocks();
    }

    addCopyButtonsToExistingBlocks() {
        const codeBlocks = document.querySelectorAll('pre:not(.code-block)');
        codeBlocks.forEach(pre => {
            if (pre.querySelector('code')) {
                pre.classList.add('code-block');
                this.addCopyButtonToCodeBlock(pre);
            }
        });
    }

    addCopyButtonToCodeBlock(block) {
        if (!block || block.querySelector('.copy-button')) return;

        const copyButton = this.createElement('button', {
            className: 'copy-button',
            attributes: {
                'aria-label': 'Copy code',
                'title': 'Copy to clipboard'
            }
        });
        
        const icon = this.createElement('i', {
            className: 'fas fa-copy'
        });
        copyButton.appendChild(icon);

        copyButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.copyCodeToClipboard(block, copyButton);
        });

        block.style.position = 'relative';
        block.appendChild(copyButton);
    }

    async copyCodeToClipboard(block, button) {
        try {
            const code = block.querySelector('code');
            const text = code ? code.textContent : block.textContent;
            
            await navigator.clipboard.writeText(text);
            this.showCopySuccess(button);
        } catch (err) {
            this.showCopyError(button);
        }
    }

    showCopySuccess(button) {
        const originalContent = button.innerHTML;
        this.setElementContent(button, '', true);
        
        const checkIcon = this.createElement('i', {
            className: 'fas fa-check'
        });
        button.appendChild(checkIcon);
        
        button.classList.add('copied');
        
        this.copyAnimationQueue.set(button, setTimeout(() => {
            button.innerHTML = originalContent;
            button.classList.remove('copied');
            this.copyAnimationQueue.delete(button);
        }, 2000));
    }

    showCopyError(button) {
        const originalContent = button.innerHTML;
        this.setElementContent(button, '', true);
        
        const errorIcon = this.createElement('i', {
            className: 'fas fa-exclamation-triangle'
        });
        button.appendChild(errorIcon);
        
        button.classList.add('error');
        
        setTimeout(() => {
            button.innerHTML = originalContent;
            button.classList.remove('error');
        }, 2000);
    }

    setupThemeObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    const newTheme = document.documentElement.getAttribute('data-theme');
                    if (newTheme !== this.currentTheme) {
                        this.currentTheme = newTheme;
                        localStorage.setItem('theme', newTheme);
                        this.updateThemeButton();
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    setupCodeBlockObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { 
                        const newPreElements = node.querySelectorAll ? node.querySelectorAll('pre:not(.code-block)') : [];
                        newPreElements.forEach(pre => {
                            if (pre.querySelector('code')) {
                                pre.classList.add('code-block');
                                this.addCopyButtonToCodeBlock(pre);
                            }
                        });
                        
                        if (node.tagName === 'PRE' && node.querySelector('code') && !node.classList.contains('code-block')) {
                            node.classList.add('code-block');
                            this.addCopyButtonToCodeBlock(node);
                        }
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    updateActiveNavigation(route) {
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

    observeContentChanges() {
        this.setupCodeBlockObserver();
    }
}

function toggleTheme() {
    if (window.capiDocsCore) {
        window.capiDocsCore.toggleTheme();
    }
}

function toggleSidebar() {
    if (window.capiDocsCore) {
        window.capiDocsCore.toggleSidebar();
    }
}

function toggleMobileNav() {
    if (window.capiDocsCore) {
        window.capiDocsCore.toggleMobileNav();
    }
}

function initializeCapiDocsCore() {
    if (!window.capiDocsCore) {
        window.capiDocsCore = new CapiDocsCore();
    }
    return window.capiDocsCore;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CapiDocsCore, initializeCapiDocsCore };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCapiDocsCore);
} else {
    initializeCapiDocsCore();
} 