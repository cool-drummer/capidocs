const ALLOWED_TAGS = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'kbd', 'a', 'ul', 'ol', 'li',
    'blockquote', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    'span', 'sup', 'sub', 'img', 'figure', 'figcaption', 'dl', 'dt', 'dd'
]);

const DROPPED_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math',
    'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'
]);

const ALLOWED_ATTRS = {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    code: ['class'],
    pre: ['class']
};

const UNSAFE_PROTOCOL = /^\s*(?:javascript|data|vbscript|file):/i;

function safeUrl(value) {
    const trimmed = String(value || '').replace(/[^\x20-\x7e\u00a0-\uffff]/g, '').trim();
    if (!trimmed || UNSAFE_PROTOCOL.test(trimmed)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^(?:https?|mailto|tel):/i.test(trimmed)) return null;
    return trimmed;
}

function cleanElement(element, doc) {
    const tag = element.tagName.toLowerCase();

    if (DROPPED_TAGS.has(tag)) {
        element.remove();
        return;
    }

    Array.from(element.children).forEach((child) => cleanElement(child, doc));

    if (!ALLOWED_TAGS.has(tag)) {
        const fragment = doc.createDocumentFragment();
        while (element.firstChild) fragment.appendChild(element.firstChild);
        element.replaceWith(fragment);
        return;
    }

    const allowed = ALLOWED_ATTRS[tag] || [];
    Array.from(element.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (!allowed.includes(name)) {
            element.removeAttribute(attr.name);
            return;
        }
        if (name === 'href' || name === 'src') {
            const url = safeUrl(attr.value);
            if (url) element.setAttribute(name, url);
            else element.removeAttribute(attr.name);
        }
        if (name === 'class' && !/^language-[\w-]+$/.test(attr.value)) {
            element.removeAttribute(attr.name);
        }
    });

    const href = tag === 'a' ? element.getAttribute('href') : null;
    if (href && /^https?:/i.test(href)) {
        element.setAttribute('rel', 'noopener noreferrer');
        element.setAttribute('target', '_blank');
    }
    if (tag === 'img') {
        element.setAttribute('loading', 'lazy');
    }
}

export function sanitizeHtml(html, Parser = globalThis.DOMParser) {
    if (!html) return '';
    const doc = new Parser().parseFromString('<!doctype html><body>' + String(html), 'text/html');
    Array.from(doc.body.children).forEach((child) => cleanElement(child, doc));
    return doc.body.innerHTML;
}
