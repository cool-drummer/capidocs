import { highlight } from './highlighter.js';

function activate(container, tabSelector, panelSelector, tab, targetId) {
    container.querySelectorAll(tabSelector).forEach((item) => {
        item.classList.remove('active');
        if (item.hasAttribute('aria-selected')) item.setAttribute('aria-selected', 'false');
    });
    container.querySelectorAll(panelSelector).forEach((panel) => panel.classList.remove('active'));
    tab.classList.add('active');
    if (tab.hasAttribute('aria-selected')) tab.setAttribute('aria-selected', 'true');
    const panel = document.getElementById(targetId);
    if (panel) {
        panel.classList.add('active');
        highlight(panel);
    }
}

function copyPanel(button) {
    const panel = button.closest('.code-panel');
    const code = panel ? panel.querySelector('.code-panel-body.active code') : null;
    if (!code || !navigator.clipboard) return;
    navigator.clipboard.writeText(code.textContent).then(() => {
        const icon = button.querySelector('i');
        if (!icon) return;
        icon.className = 'fas fa-check';
        button.classList.add('copied');
        setTimeout(() => {
            icon.className = 'fas fa-copy';
            button.classList.remove('copied');
        }, 1600);
    }).catch(() => undefined);
}

export function bindInteractions(root = document) {
    root.addEventListener('click', (event) => {
        const tryButton = event.target.closest('[data-playground-toggle]');
        if (tryButton) {
            const head = tryButton.closest('.endpoint-head');
            const playground = head ? head.querySelector('.playground') : null;
            if (playground) {
                playground.hidden = !playground.hidden;
                tryButton.classList.toggle('open', !playground.hidden);
            }
            return;
        }

        const panelTab = event.target.closest('.code-panel-tab[data-panel-target]');
        if (panelTab) {
            const panel = panelTab.closest('.code-panel');
            if (panel) activate(panel, '.code-panel-tab', '.code-panel-body', panelTab, panelTab.getAttribute('data-panel-target'));
            return;
        }

        const panelCopy = event.target.closest('.code-panel-copy');
        if (panelCopy) {
            copyPanel(panelCopy);
            return;
        }

        const techTab = event.target.closest('.tech-tab[data-target]');
        if (techTab) {
            const container = techTab.closest('.multi-tech-examples');
            if (container) activate(container, '.tech-tab', '.tech-example', techTab, techTab.getAttribute('data-target'));
            return;
        }

        const docTab = event.target.closest('.doc-tab[data-tab-target]');
        if (docTab) {
            const wrap = docTab.closest('.doc-tabs');
            if (wrap) activate(wrap, '.doc-tab', '.doc-tab-panel', docTab, docTab.getAttribute('data-tab-target'));
            return;
        }

        const accordionHead = event.target.closest('.accordion-head[data-accordion]');
        if (accordionHead) {
            const item = accordionHead.closest('.accordion-item');
            if (item) {
                const open = item.classList.toggle('open');
                accordionHead.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
        }
    });
}
