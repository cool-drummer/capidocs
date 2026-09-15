import { slug } from './spec-utils.js';

const SKIP_CONTAINERS = [
    '.hero-section', '.navbar', '.footer', '.toc-sidebar', '.alert', '.warning-box', '.note-box', '.audience-box',
    '.success-box', '.error-box', '.sidebar', '.hero-content', '.footer-content', '.loading-spinner', '.error-page'
];

const SKIP_CLASSES = [
    'hero-title', 'hero-subtitle', 'footer-title', 'footer-subtitle', 'navbar-brand', 'loading-title', 'error-title',
    'alert-title', 'page-title', 'section-subtitle', 'breadcrumb-current', 'breadcrumb-item'
];

export class Toc {
    constructor({ config = {}, list, sidebar, mainContent, footer }) {
        this.config = config;
        this.list = list;
        this.sidebar = sidebar;
        this.mainContent = mainContent;
        this.footer = footer;
        this.headings = [];
        this.suppressScroll = false;
        this.bindScroll();
    }

    bindScroll() {
        let ticking = false;
        window.addEventListener('scroll', () => {
            if (ticking || this.suppressScroll) return;
            ticking = true;
            requestAnimationFrame(() => {
                this.updateActiveLink();
                ticking = false;
            });
        }, { passive: true });
    }

    refresh(route) {
        if (!this.list || !this.mainContent || !this.sidebar) return;
        this.headings = this.disabledFor(route) ? [] : this.collectHeadings();
        if (!this.headings.length) {
            this.setVisible(false);
            return;
        }
        this.setVisible(true);
        this.list.innerHTML = '';
        this.headings.forEach((heading, index) => {
            if (!heading.id) heading.id = this.uniqueId(heading, index);
            this.list.appendChild(this.createItem(heading));
        });
        this.updateActiveLink();
    }

    scrollToHash() {
        const hash = window.location.hash.slice(1);
        if (!hash) return;
        const target = document.getElementById(hash);
        if (target && this.headings.includes(target)) this.scrollToHeading(hash, false);
    }

    disabledFor(route) {
        if (this.config.enabled === false) return true;
        if ((this.config.exclude_pages || []).includes(route)) return true;
        const min = this.config.min_headings || 2;
        return this.mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6').length < min;
    }

    collectHeadings() {
        return Array.from(this.mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter((heading) => this.include(heading));
    }

    include(heading) {
        if (SKIP_CONTAINERS.some((selector) => heading.closest(selector))) return false;
        if (heading.closest('[data-toc-exclude="true"]')) return false;
        if (SKIP_CLASSES.some((cls) => heading.classList.contains(cls))) return false;
        const text = heading.textContent.trim();
        if (text.length < 2) return false;
        const exclude = this.config.exclude_headings || {};
        if ((exclude.texts || []).some((entry) => entry.toLowerCase() === text.toLowerCase())) return false;
        if ((exclude.selectors || []).some((selector) => heading.matches(selector) || heading.closest(selector))) return false;
        return true;
    }

    uniqueId(heading, index) {
        const base = slug(heading.textContent) || `heading-${index}`;
        let id = base;
        let counter = 1;
        while (document.getElementById(id)) id = `${base}-${counter++}`;
        return id;
    }

    createItem(heading) {
        const item = document.createElement('li');
        item.className = `toc-item level-${heading.tagName.substring(1)}`;
        const link = document.createElement('a');
        link.href = `#${heading.id}`;
        link.className = 'toc-link';
        link.textContent = heading.textContent.trim();
        link.addEventListener('click', (event) => {
            event.preventDefault();
            this.scrollToHeading(heading.id, true);
        });
        item.appendChild(link);
        return item;
    }

    setVisible(visible) {
        this.sidebar.style.display = visible ? 'block' : 'none';
        this.mainContent.classList.toggle('no-toc', !visible);
        if (this.footer) {
            this.footer.classList.toggle('with-toc', visible);
            this.footer.classList.toggle('no-toc', !visible);
        }
    }

    navbarHeight() {
        const navbar = document.querySelector('.navbar');
        return navbar ? navbar.offsetHeight : 56;
    }

    elementTop(element) {
        let top = 0;
        let current = element;
        while (current) {
            top += current.offsetTop;
            current = current.offsetParent;
        }
        return top;
    }

    scrollToHeading(id, pushHistory) {
        const heading = document.getElementById(id);
        if (!heading) return;
        this.suppressScroll = true;
        window.scrollTo({ top: Math.max(0, this.elementTop(heading) - this.navbarHeight() - 20), behavior: 'smooth' });
        if (pushHistory) history.pushState(null, '', `#${id}`);
        setTimeout(() => {
            this.suppressScroll = false;
            this.updateActiveLink();
        }, 700);
    }

    updateActiveLink() {
        if (!this.headings.length) return;
        const scrollPosition = window.scrollY + window.innerHeight * 0.1;
        const navbarHeight = this.navbarHeight();
        let active = null;
        let closest = Infinity;
        for (const heading of this.headings) {
            if (!heading.offsetParent) continue;
            const top = this.elementTop(heading);
            const bottom = top + heading.offsetHeight;
            const distance = Math.abs(top - scrollPosition);
            const inViewport = top <= scrollPosition + navbarHeight + 100 && bottom >= scrollPosition - navbarHeight;
            if (inViewport && distance < closest) {
                closest = distance;
                active = heading;
            }
        }
        if (!active) {
            for (let i = this.headings.length - 1; i >= 0; i--) {
                const heading = this.headings[i];
                if (heading.offsetParent && this.elementTop(heading) <= scrollPosition + navbarHeight) {
                    active = heading;
                    break;
                }
            }
        }
        this.list.querySelectorAll('.toc-link').forEach((link) => link.classList.remove('active'));
        if (!active) return;
        const link = this.list.querySelector(`a[href="#${active.id}"]`);
        if (!link) return;
        link.classList.add('active');
        const sidebarRect = this.sidebar.getBoundingClientRect();
        const linkRect = link.getBoundingClientRect();
        if (linkRect.top < sidebarRect.top || linkRect.bottom > sidebarRect.bottom) {
            this.sidebar.scrollTo({ top: Math.max(0, link.offsetTop - this.sidebar.clientHeight / 2), behavior: 'smooth' });
        }
    }
}
