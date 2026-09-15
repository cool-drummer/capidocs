import { createTranslator } from './spec-loader.js';
import { applyBrandTheme } from './theme.js';
import { Core } from './core.js';
import { Chrome } from './chrome.js';
import { ContentGenerator } from './content-generator.js';
import { Router } from './router.js';
import { Toc } from './toc.js';
import { Search } from './search.js';
import { highlight } from './highlighter.js';
import { bindInteractions } from './interactions.js';
import { bindPlayground } from './playground.js';
import { bindPageActions } from './page-actions.js';
import { bindFeedback } from './feedback.js';
import { renderLanguageSelect, renderVersionSelect } from './selectors.js';
import { initAccess } from './access.js';

export async function createCapidocs({ spec, assetBase = '', searchIndexUrl = 'search-index.json' }) {
    const site = spec.site_config || {};
    const t = createTranslator(spec);
    const resolveAsset = (path) => (assetBase && !/^(?:[a-z]+:|\/)/i.test(path) ? assetBase.replace(/\/?$/, '/') + path : path);

    applyBrandTheme(site.theme, document, resolveAsset);

    const core = new Core({ t, defaultTheme: site.default_theme });
    const chrome = new Chrome({ spec, t, resolveAsset });
    chrome.render();

    const contentGenerator = new ContentGenerator({ spec, t, resolveAsset });
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = contentGenerator.generateSidebar();
    contentGenerator.renderNavbarTabs(document.getElementById('navbar-tabs'));

    const toc = new Toc({
        config: site.toc || {},
        list: document.getElementById('toc-list'),
        sidebar: document.getElementById('toc-sidebar'),
        mainContent: document.getElementById('main-content'),
        footer: document.querySelector('.footer')
    });

    const router = new Router({
        spec,
        contentGenerator,
        mainContent: document.getElementById('main-content'),
        onRendered: (route, container) => {
            core.updateActiveNavigation(route);
            core.closeSidebar();
            contentGenerator.syncTabs(route);
            core.enhanceCodeBlocks(container);
            highlight(container);
            toc.refresh(route);
        }
    });

    bindInteractions();
    bindPlayground({ t });
    bindPageActions({ spec, t });
    bindFeedback({ t });
    renderVersionSelect(spec, t);
    renderLanguageSelect(spec, t);

    const search = new Search({ spec, t, navigate: (route) => router.navigate(route), indexUrl: searchIndexUrl });

    await router.start();
    toc.scrollToHash();
    initAccess({ spec, t, resolveAsset });

    document.documentElement.dataset.capidocs = 'ready';
    document.dispatchEvent(new CustomEvent('capidocs:ready'));
    return { spec, core, chrome, contentGenerator, router, toc, search, t };
}
