const LANGUAGE_ALIASES = { curl: 'bash', console: 'shell-session', text: 'none', plain: 'none' };

function normalizeLanguage(element) {
    for (const name of [...element.classList]) {
        const match = /^language-(.+)$/.exec(name);
        if (match && LANGUAGE_ALIASES[match[1]]) {
            element.classList.replace(name, `language-${LANGUAGE_ALIASES[match[1]]}`);
            element.dataset.language = match[1];
        }
    }
}

export function highlight(container = document) {
    if (typeof Prism === 'undefined') return;
    container.querySelectorAll('pre code[class*="language-"]').forEach((element) => {
        if (element.classList.contains('highlighted')) return;
        normalizeLanguage(element);
        Prism.highlightElement(element);
        element.classList.add('highlighted');
    });
}

export function highlightElement(element) {
    if (typeof Prism === 'undefined' || !element) return;
    normalizeLanguage(element);
    Prism.highlightElement(element);
}
