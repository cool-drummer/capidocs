class TocGenerator {
    constructor() {
        this.tocContainer = document.getElementById('toc-list');
        this.tocSidebar = document.getElementById('toc-sidebar');
        this.mainContent = document.getElementById('main-content');
        this.headings = [];
        this.activeLink = null;
        this.isScrolling = false;
        this.config = null;
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        await this.loadConfig();
        
        setTimeout(() => {
            this.generateTOC();
            this.setupScrollHandler();
            this.handleInitialHash();
            this.updateActiveLink();
        }, 500);
        
        this.observeContentChanges();
        
        window.addEventListener('hashchange', () => {
            this.handleHashChange();
        });
    }

    async loadConfig() {
        try {
            const config = await window.configLoader.load();
            this.config = config.site_config?.toc || {};
        } catch (error) {
            this.config = {};
        }
    }

    generateTOC() {
        if (!this.tocContainer || !this.mainContent) return;

        if (this.isTocDisabledForCurrentPage()) {
            this.tocSidebar.style.display = 'none';
            this.mainContent.classList.add('no-toc');
            this.updateFooterLayout(false);
            return;
        }

        this.mainContent.classList.remove('no-toc');

        const headingSelectors = 'h1, h2, h3, h4, h5, h6';
        const allHeadings = this.mainContent.querySelectorAll(headingSelectors);
        
        this.headings = Array.from(allHeadings).filter(heading => {
            return this.shouldIncludeHeading(heading);
        });

        if (this.headings.length === 0) {
            this.tocSidebar.style.display = 'none';
            this.mainContent.classList.add('no-toc');
            this.updateFooterLayout(false);
            return;
        }

        this.tocSidebar.style.display = 'block';
        this.updateFooterLayout(true);
        
        this.tocContainer.innerHTML = '';
        
        this.headings.forEach((heading, index) => {
            const id = this.generateId(heading, index);
            const level = parseInt(heading.tagName.substring(1));
            
            if (!heading.id) {
                heading.id = id;
            }
            
            const tocItem = this.createTocItem(heading, level);
            this.tocContainer.appendChild(tocItem);
        });
    }

    shouldIncludeHeading(heading) {
        const skipContainers = [
            '.hero-section',
            '.navbar', 
            '.footer', 
            '.toc-sidebar',
            '.alert',
            '.warning-box',
            '.note-box',
            '.audience-box',
            '.success-box',
            '.error-box',
            '.sidebar',
            '.hero-content',
            '.footer-content',
            '.loading-spinner',
            '.error-page'
        ];
        
        for (const selector of skipContainers) {
            if (heading.closest(selector)) {
                return false;
            }
        }
        
        if (heading.hasAttribute('data-toc-exclude') || 
            heading.getAttribute('data-toc-exclude') === 'true') {
            return false;
        }
        
        const excludedParent = heading.closest('[data-toc-exclude="true"]');
        if (excludedParent) {
            return false;
        }
        
        const excludeClasses = [
            'hero-title',
            'hero-subtitle',
            'footer-title',
            'footer-subtitle',
            'navbar-brand',
            'loading-title',
            'error-title',
            'alert-title',
            'page-title',
            'section-subtitle',
            'breadcrumb-current',
            'breadcrumb-item'
        ];
        
        for (const className of excludeClasses) {
            if (heading.classList.contains(className)) {
                return false;
            }
        }
        
        const headingText = heading.textContent.trim().toLowerCase();
        const excludeTexts = [
            'cargando',
            'loading',
            'error',
            '404',
            'not found',
            'página no encontrada',
        ];
        
        if (excludeTexts.includes(headingText) || headingText.length < 2) {
            return false;
        }
        
        if (this.config.exclude_headings) {
            if (this.config.exclude_headings.texts) {
                const excludeConfigTexts = this.config.exclude_headings.texts.map(t => t.toLowerCase());
                if (excludeConfigTexts.includes(headingText)) {
                    return false;
                }
            }
            
            if (this.config.exclude_headings.selectors) {
                for (const selector of this.config.exclude_headings.selectors) {
                    if (heading.matches(selector) || heading.closest(selector)) {
                        return false;
                    }
                }
            }
        }
        
        return true;
    }

    isTocDisabledForCurrentPage() {
        const currentRoute = window.location.hash.slice(1) || 'home';
        
        if (this.config.enabled === false) {
            return true;
        }
        
        if (this.config.exclude_pages && this.config.exclude_pages.includes(currentRoute)) {
            return true;
        }
        
        const minHeadings = this.config.min_headings || 2;
        const headingCount = this.mainContent ? 
            this.mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6').length : 0;
        
        if (headingCount < minHeadings) {
            return true;
        }
        
        return false;
    }

    generateId(heading, index) {
        let id = heading.textContent
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        if (!id) {
            id = `heading-${index}`;
        }
        
        let uniqueId = id;
        let counter = 1;
        while (document.getElementById(uniqueId)) {
            uniqueId = `${id}-${counter}`;
            counter++;
        }
        
        return uniqueId;
    }

    createTocItem(heading, level) {
        const listItem = document.createElement('li');
        listItem.className = `toc-item level-${level}`;
        
        const link = document.createElement('a');
        link.href = `#${heading.id}`;
        link.className = 'toc-link';
        link.textContent = heading.textContent.trim();
        
        link.addEventListener('click', (e) => {
            e.preventDefault();
            this.scrollToHeading(heading.id);
        });
        
        listItem.appendChild(link);
        return listItem;
    }

    setupScrollHandler() {
        let ticking = false;
        
        const handleScroll = () => {
            if (!ticking && !this.isScrolling) {
                requestAnimationFrame(() => {
                    this.updateActiveLink();
                    ticking = false;
                });
                ticking = true;
            }
        };
        
        window.addEventListener('scroll', handleScroll, { passive: true });
        
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.updateActiveLink();
            }, 100);
        });
    }

    updateActiveLink() {
        if (this.headings.length === 0) return;
        
        const scrollPosition = window.scrollY + window.innerHeight * 0.1;
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 56;
        const windowHeight = window.innerHeight;
        
        let activeHeading = null;
        let closestDistance = Infinity;
        
        for (const heading of this.headings) {
            if (!heading.offsetParent) continue;
            
            const headingTop = this.getElementTop(heading);
            const headingBottom = headingTop + heading.offsetHeight;
            
            const distanceFromTop = Math.abs(headingTop - scrollPosition);
            
            const isInViewport = headingTop <= scrollPosition + navbarHeight + 100 && 
                               headingBottom >= scrollPosition - navbarHeight;
            
            if (isInViewport && distanceFromTop < closestDistance) {
                closestDistance = distanceFromTop;
                activeHeading = heading;
            }
        }
        
        if (!activeHeading) {
            for (let i = this.headings.length - 1; i >= 0; i--) {
                const heading = this.headings[i];
                if (!heading.offsetParent) continue;
                
                const headingTop = this.getElementTop(heading);
                if (headingTop <= scrollPosition + navbarHeight) {
                    activeHeading = heading;
                    break;
                }
            }
        }
        
        this.setActiveLink(activeHeading);
    }

    getElementTop(element) {
        let offsetTop = 0;
        let currentElement = element;
        
        while (currentElement) {
            offsetTop += currentElement.offsetTop;
            currentElement = currentElement.offsetParent;
        }
        
        return offsetTop;
    }

    setActiveLink(activeHeading) {
        const tocLinks = this.tocContainer.querySelectorAll('.toc-link');
        tocLinks.forEach(link => link.classList.remove('active'));
        
        if (activeHeading && activeHeading.id) {
            const activeLink = this.tocContainer.querySelector(`a[href="#${activeHeading.id}"]`);
            if (activeLink) {
                activeLink.classList.add('active');
                this.activeLink = activeLink;
                
                this.scrollTocToActiveItem(activeLink);
            }
        }
    }

    scrollTocToActiveItem(activeLink) {
        if (!this.tocSidebar || !activeLink) return;
        
        const tocRect = this.tocSidebar.getBoundingClientRect();
        const linkRect = activeLink.getBoundingClientRect();
        
        if (linkRect.top < tocRect.top || linkRect.bottom > tocRect.bottom) {
            const scrollTop = this.tocSidebar.scrollTop;
            const linkOffsetTop = activeLink.offsetTop;
            const tocHeight = this.tocSidebar.clientHeight;
            
            const newScrollTop = linkOffsetTop - tocHeight / 2;
            
            this.tocSidebar.scrollTo({
                top: Math.max(0, newScrollTop),
                behavior: 'smooth'
            });
        }
    }

    scrollToHeading(headingId) {
        const heading = document.getElementById(headingId);
        if (!heading) return;
        
        this.isScrolling = true;
        
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 56;
        const elementTop = this.getElementTop(heading);
        const offset = elementTop - navbarHeight - 20;
        
        window.scrollTo({
            top: Math.max(0, offset),
            behavior: 'smooth'
        });
        
        if (history.pushState) {
            history.pushState(null, null, `#${headingId}`);
        } else {
            window.location.hash = headingId;
        }
        
        setTimeout(() => {
            this.isScrolling = false;
            this.updateActiveLink();
        }, 1000);
    }

    observeContentChanges() {
        const observer = new MutationObserver((mutations) => {
            let shouldRegenerate = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const addedHeadings = Array.from(mutation.addedNodes)
                        .filter(node => node.nodeType === 1)
                        .some(node => 
                            node.matches && node.matches('h1, h2, h3, h4, h5, h6') ||
                            node.querySelector && node.querySelector('h1, h2, h3, h4, h5, h6')
                        );
                    
                    if (addedHeadings) {
                        shouldRegenerate = true;
                    }
                }
            });
            
            if (shouldRegenerate) {
                setTimeout(() => this.generateTOC(), 100);
            }
        });
        
        if (this.mainContent) {
            observer.observe(this.mainContent, {
                childList: true,
                subtree: true
            });
        }
    }

    refresh() {
        setTimeout(() => {
            this.generateTOC();
            this.updateActiveLink();
        }, 100);
    }

    debug(enable = true) {
        if (enable) {
            document.body.classList.add('toc-debug');
            
            this.headings.forEach(heading => {
                heading.style.outline = '2px solid green';
                heading.style.outlineOffset = '2px';
            });
            
        } else {
            document.body.classList.remove('toc-debug');
            
            this.headings.forEach(heading => {
                heading.style.outline = '';
                heading.style.outlineOffset = '';
            });
        }
    }

    getScrollInfo() {
        const scrollPosition = window.scrollY;
        const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 56;
        
        return {
            scrollPosition,
            navbarHeight,
            windowHeight: window.innerHeight,
            headingPositions: this.headings.map(heading => ({
                id: heading.id,
                text: heading.textContent.trim(),
                top: this.getElementTop(heading),
                visible: heading.offsetParent !== null
            }))
        };
    }

    excludeSection(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.setAttribute('data-toc-exclude', 'true');
        });
        this.refresh();
    }

    includeSection(selector) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            element.removeAttribute('data-toc-exclude');
        });
        this.refresh();
    }

    handleInitialHash() {
        const hash = window.location.hash.slice(1);
        if (hash) {
            setTimeout(() => {
                this.scrollToHeading(hash);
            }, 100);
        }
    }

    handleHashChange() {
        const hash = window.location.hash.slice(1);
        if (hash && !this.isScrolling) {
            const heading = document.getElementById(hash);
            if (heading && this.headings.includes(heading)) {
                this.scrollToHeading(hash);
            }
        }
    }

    updateFooterLayout(tocVisible) {
        const footer = document.querySelector('.footer');
        if (!footer) return;

        if (tocVisible) {
            footer.classList.remove('no-toc');
            footer.classList.add('with-toc');
        } else {
            footer.classList.remove('with-toc');
            footer.classList.add('no-toc');
        }
    }
}

const tocGenerator = new TocGenerator();

window.tocGenerator = tocGenerator; 