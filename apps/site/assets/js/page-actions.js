import { pageMarkdown } from './spec-utils.js';

function flash(button, text) {
    const original = button.innerHTML;
    button.innerHTML = `<i class="fas fa-check"></i> ${text}`;
    setTimeout(() => { button.innerHTML = original; }, 1400);
}

function closeMenus() {
    document.querySelectorAll('.page-actions.open').forEach((menu) => menu.classList.remove('open'));
}

function openMarkdownWindow(markdown) {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.title = 'Markdown';
    const pre = popup.document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font-family:ui-monospace,monospace;padding:24px;max-width:820px;margin:0 auto;line-height:1.5';
    pre.textContent = markdown;
    popup.document.body.appendChild(pre);
}

export function bindPageActions({ spec, t }) {
    document.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-page-actions]');
        if (toggle) {
            event.preventDefault();
            const actions = toggle.closest('.page-actions');
            const wasOpen = actions.classList.contains('open');
            closeMenus();
            if (!wasOpen) actions.classList.add('open');
            return;
        }

        const item = event.target.closest('.page-actions-menu [data-action]');
        if (item) {
            event.preventDefault();
            const actions = item.closest('.page-actions');
            const route = (actions && actions.getAttribute('data-route')) || (location.hash.slice(1) || 'home');
            const action = item.getAttribute('data-action');
            const markdown = pageMarkdown(spec, route);

            if (action === 'copy-md') {
                (navigator.clipboard ? navigator.clipboard.writeText(markdown) : Promise.reject(new Error('clipboard')))
                    .then(() => flash(item, t('copied', 'Copiado')))
                    .catch(() => flash(item, t('copy_failed', 'No se pudo copiar')));
                return;
            }
            if (action === 'view-md') {
                openMarkdownWindow(markdown);
            } else {
                const prompt = `${t('ai_prompt', 'Estoy leyendo esta página de documentación de API')} (${location.href}). ${t('ai_prompt_ask', 'Ayúdame a entenderla y responde mis preguntas.')}\n\n${markdown}`;
                if (action === 'open-claude') window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener');
                else if (action === 'open-chatgpt') window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener');
            }
            closeMenus();
            return;
        }

        if (!event.target.closest('.page-actions')) closeMenus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenus();
    });
}
