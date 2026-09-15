const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

export const escapeAttr = escapeHtml;
