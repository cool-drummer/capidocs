export function highlight(container = document) {
    if (typeof Prism === 'undefined') return;
    container.querySelectorAll('pre code[class*="language-"]').forEach((element) => {
        if (element.classList.contains('highlighted')) return;
        Prism.highlightElement(element);
        element.classList.add('highlighted');
    });
}

export function highlightElement(element) {
    if (typeof Prism === 'undefined' || !element) return;
    Prism.highlightElement(element);
}
