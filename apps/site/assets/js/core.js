const THEME_KEY = 'theme';
const USER_SET_KEY = 'theme_user_set';

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        return;
    }
}

export function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export class Core {
    constructor({ t, defaultTheme }) {
        this.t = t;
        this.userSetTheme = !!readStorage(USER_SET_KEY);
        this.currentTheme = this.resolveInitialTheme(defaultTheme);
        this.applyTheme(this.currentTheme, false);
        this.watchSystemTheme();
        this.bindControls();
    }

    resolveInitialTheme(defaultTheme) {
        if (this.userSetTheme) return readStorage(THEME_KEY) || systemTheme();
        if (defaultTheme === 'light' || defaultTheme === 'dark') return defaultTheme;
        return systemTheme();
    }

    watchSystemTheme() {
        if (!window.matchMedia) return;
        const query = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (event) => {
            if (!readStorage(USER_SET_KEY)) this.applyTheme(event.matches ? 'dark' : 'light', false);
        };
        if (query.addEventListener) query.addEventListener('change', handler);
    }

    bindControls() {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.addEventListener('click', () => this.toggleTheme());

        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        if (mobileMenuToggle) mobileMenuToggle.addEventListener('click', () => this.toggleSidebar());

        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) overlay.addEventListener('click', () => this.toggleSidebar());

        document.addEventListener('click', (event) => {
            if (event.target.closest('.sidebar-toggle')) {
                event.preventDefault();
                this.toggleSidebar();
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) this.closeSidebar();
        });
    }

    applyTheme(theme, persist = true) {
        document.documentElement.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        if (persist) {
            writeStorage(THEME_KEY, theme);
            writeStorage(USER_SET_KEY, '1');
        }
        this.updateThemeButton();
        document.dispatchEvent(new CustomEvent('capidocs:theme', { detail: { theme } }));
    }

    updateThemeButton() {
        const icon = document.getElementById('theme-icon');
        const toggle = document.getElementById('theme-toggle');
        const dark = this.currentTheme === 'dark';
        if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        if (toggle) {
            const label = dark ? this.t('theme_to_light', 'Cambiar a tema claro') : this.t('theme_to_dark', 'Cambiar a tema oscuro');
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('title', label);
        }
    }

    toggleTheme() {
        this.applyTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) this.closeSidebar();
        else this.openSidebar();
    }

    openSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) return;
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (!sidebar || !overlay) return;
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    enhanceCodeBlocks(container = document) {
        container.querySelectorAll('pre').forEach((pre) => {
            if (!pre.querySelector('code') || pre.classList.contains('code-panel-pre') || pre.querySelector('.copy-button')) return;
            pre.classList.add('code-block');
            this.addCopyButton(pre);
        });
    }

    addCopyButton(block) {
        const wrapper = block.parentElement;
        const header = wrapper && wrapper.classList.contains('code-block') ? wrapper.querySelector(':scope > .code-title') : null;
        if (header && header.querySelector('.copy-button')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy-button';
        button.setAttribute('aria-label', this.t('copy_code', 'Copiar código'));
        button.setAttribute('title', this.t('copy_code', 'Copiar código'));
        button.innerHTML = '<i class="fas fa-copy"></i>';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            this.copyBlock(block, button);
        });

        if (header) {
            button.classList.add('in-header');
            header.appendChild(button);
        } else {
            block.style.position = 'relative';
            block.appendChild(button);
        }
    }

    async copyBlock(block, button) {
        const code = block.querySelector('code');
        const text = code ? code.textContent : block.textContent;
        try {
            await navigator.clipboard.writeText(text);
            this.flashButton(button, 'fas fa-check', 'copied');
        } catch {
            this.flashButton(button, 'fas fa-exclamation-triangle', 'error');
        }
    }

    flashButton(button, iconClass, stateClass) {
        const original = button.innerHTML;
        button.innerHTML = `<i class="${iconClass}"></i>`;
        button.classList.add(stateClass);
        setTimeout(() => {
            button.innerHTML = original;
            button.classList.remove(stateClass);
        }, 2000);
    }

    updateActiveNavigation(route) {
        document.querySelectorAll('.sidebar-nav-link, .nav-link, .sidebar a[href^="#"], .navbar-nav a[href^="#"]').forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + route);
        });
    }
}
