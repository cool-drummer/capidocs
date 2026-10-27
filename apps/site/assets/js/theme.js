function parseHex(hex) {
    const raw = String(hex || '').replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function toHex(rgb) {
    return '#' + rgb.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
}

export function rgba(hex, alpha) {
    const rgb = parseHex(hex);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex;
}

export function mix(hex, target, amount) {
    const a = parseHex(hex);
    const b = parseHex(target);
    if (!a || !b) return hex;
    return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

export function onAccent(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return '#ffffff';
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#0b0b0c' : '#ffffff';
}

function accentBlock(selector, accent, mode) {
    const hover = mode === 'dark' ? mix(accent, '#ffffff', 0.18) : mix(accent, '#000000', 0.18);
    const tint = mode === 'dark' ? 0.14 : 0.09;
    const border = mode === 'dark' ? 0.35 : 0.3;
    return [
        `${selector} {`,
        `    --brand-accent: ${accent};`,
        `    --brand-accent-hover: ${hover};`,
        `    --brand-accent-light: ${rgba(accent, tint)};`,
        `    --brand-accent-border: ${rgba(accent, border)};`,
        `    --accent-solid: ${accent};`,
        `    --on-accent: ${onAccent(accent)};`,
        `    --brand-primary: ${accent};`,
        `    --border-focus: ${accent};`,
        '}'
    ].join('\n');
}

export function brandCss(theme) {
    if (!theme) return '';
    const blocks = [];
    if (theme.accent) {
        blocks.push(accentBlock(':root', theme.accent.dark, 'dark'));
        blocks.push(accentBlock('[data-theme="light"]', theme.accent.light, 'light'));
    }
    const fonts = theme.fonts || {};
    const fontLines = [];
    if (fonts.sans) fontLines.push(`    --font-sans: ${fonts.sans};`);
    if (fonts.headings || fonts.sans) fontLines.push(`    --font-headings: ${fonts.headings || fonts.sans};`);
    if (fonts.mono) fontLines.push(`    --font-mono: ${fonts.mono};`);
    if (fontLines.length) blocks.push([':root {', ...fontLines, '}'].join('\n'));
    return blocks.join('\n');
}

const brandSheets = new WeakMap();

function adoptCss(doc, css) {
    const view = doc.defaultView;
    if (!view || typeof view.CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in doc)) return false;
    try {
        const sheet = new view.CSSStyleSheet();
        sheet.replaceSync(css);
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        brandSheets.set(doc, sheet);
        return true;
    } catch {
        return false;
    }
}

function applyBrandCss(doc, css) {
    const previous = brandSheets.get(doc);
    if (previous) {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== previous);
        brandSheets.delete(doc);
    }
    if (!css || adoptCss(doc, css)) return;
    const style = doc.createElement('style');
    style.id = 'capidocs-brand';
    style.textContent = css;
    doc.head.appendChild(style);
}

export function applyBrandTheme(theme, doc = document, resolveAsset = (path) => path) {
    const existing = doc.getElementById('capidocs-brand');
    if (existing) existing.remove();
    const existingSheet = doc.getElementById('capidocs-brand-sheet');
    if (existingSheet) existingSheet.remove();
    applyBrandCss(doc, '');
    if (!theme) return;
    if (theme.stylesheet) {
        const sheet = doc.createElement('link');
        sheet.id = 'capidocs-brand-sheet';
        sheet.rel = 'stylesheet';
        sheet.href = resolveAsset(theme.stylesheet);
        doc.head.appendChild(sheet);
    }
    const css = brandCss(theme);
    if (!css) return;
    const imports = (theme.fonts && theme.fonts.imports) || [];
    const present = new Set([...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute('href')));
    imports.forEach((href) => {
        if (present.has(href)) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        doc.head.appendChild(link);
    });
    applyBrandCss(doc, css);
}
