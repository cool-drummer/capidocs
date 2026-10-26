const REVOKE_DELAY_MS = 30000;

export function safeFilename(filename, fallback = 'diagram') {
    const visible = Array.from(String(filename ?? ''), (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '-' : char)).join('');
    const cleaned = visible
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/^[\s.-]+|[\s.]+$/g, '')
        .slice(0, 120);
    return cleaned || fallback;
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.rel = 'noopener';
    anchor.hidden = true;
    document.body.append(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    }
}
