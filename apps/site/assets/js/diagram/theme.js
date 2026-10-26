import { COLORS } from './model.js';

export const THEMES = ['light', 'dark'];

export const DEFAULT_ACCENT = { light: '#2f8f90', dark: '#4bb3a1' };

const SCALE = {
    neutral: { 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a' },
    blue: { 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af' },
    sky: { 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985' },
    teal: { 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59' },
    green: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534' },
    lime: { 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d', 700: '#4d7c0f', 800: '#3f6212' },
    amber: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e' },
    orange: { 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412' },
    red: { 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b' },
    pink: { 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d' },
    violet: { 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6' },
    indigo: { 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3' }
};

const SURFACES = {
    light: {
        canvas: '#f4f4f5',
        surface: '#ffffff',
        raised: '#fafafa',
        hover: '#f6f6f7',
        inset: '#f4f4f5',
        ink: '#18181b',
        muted: '#65656d',
        faint: '#a1a1aa',
        edge: '#a1a1aa',
        divider: '#e4e4e7',
        lifeline: '#d4d4d8',
        labelBg: '#18181b',
        labelText: '#fafafa',
        chip: '#ffffff',
        lane: '#e9e9ec',
        laneHeader: '#e2e2e6',
        washOpacity: 0.07,
        laneOpacity: 0.09,
        dim: 0.28
    },
    dark: {
        canvas: '#111113',
        surface: '#1c1c20',
        raised: '#232328',
        hover: '#26262c',
        inset: '#16161a',
        ink: '#fafafa',
        muted: '#a1a1aa',
        faint: '#71717a',
        edge: '#5b5b63',
        divider: '#2c2c32',
        lifeline: '#3f3f46',
        labelBg: '#3f3f46',
        labelText: '#fafafa',
        chip: '#26262b',
        lane: '#18181b',
        laneHeader: '#1f1f23',
        washOpacity: 0.1,
        laneOpacity: 0.1,
        dim: 0.3
    }
};

const UI = {
    light: {
        page: '#ffffff',
        panel: '#fafafa',
        well: '#f4f4f5',
        hover: '#f0f0f2',
        active: '#e9e9ec',
        strong: '#18181b',
        onStrong: '#fafafa',
        ink: '#18181b',
        muted: '#65656d',
        strongHover: '#3f3f46',
        rule: '#ececef',
        overlay: '#18181b',
        overlayInk: '#fafafa',
        overlayMuted: '#a1a1aa',
        overlayHover: '#2e2e33',
        dialog: '#ffffff',
        veil: '#18181b',
        veilOpacity: 0.42
    },
    dark: {
        page: '#0c0c0e',
        panel: '#121215',
        well: '#18181b',
        hover: '#1f1f23',
        active: '#27272a',
        strong: '#fafafa',
        onStrong: '#18181b',
        ink: '#fafafa',
        muted: '#a1a1aa',
        strongHover: '#d4d4d8',
        rule: '#1f1f23',
        overlay: '#2a2a30',
        overlayInk: '#fafafa',
        overlayMuted: '#a1a1aa',
        overlayHover: '#36363d',
        dialog: '#1c1c20',
        veil: '#000000',
        veilOpacity: 0.62
    }
};

const STATUS_COLORS = { ok: 'green', warning: 'amber', error: 'red', info: 'blue', neutral: 'neutral' };

function parseHex(hex) {
    const raw = String(hex).replace('#', '');
    const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
}

function toHex(rgb) {
    return `#${rgb.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`;
}

export function mixColor(base, over, amount) {
    const a = parseHex(base);
    const b = parseHex(over);
    return toHex(a.map((value, index) => value + (b[index] - value) * amount));
}

export function luminance(hex) {
    const [r, g, b] = parseHex(hex).map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

function colorTokens(name, theme) {
    const scale = SCALE[name];
    const surface = SURFACES[theme].surface;
    if (theme === 'dark') {
        return { solid: scale[400], text: scale[300], tint: mixColor(surface, scale[400], 0.2), soft: mixColor(surface, scale[400], 0.1) };
    }
    const tint = mixColor(surface, scale[500], 0.15);
    const text = contrastRatio(scale[700], tint) >= 4.6 ? scale[700] : scale[800];
    return { solid: scale[600], text, tint, soft: mixColor(surface, scale[500], 0.08) };
}

const cache = new Map();

export function themeTokens(theme = 'light', accent = DEFAULT_ACCENT) {
    const mode = theme === 'dark' ? 'dark' : 'light';
    const requested = accent && Object.hasOwn(accent, mode) ? accent[mode] : null;
    const accentHex = typeof requested === 'string' && /^#(?:[0-9a-f]{3}){1,2}$/i.test(requested) ? requested : DEFAULT_ACCENT[mode];
    const key = `${mode}|${accentHex}`;
    if (cache.has(key)) return cache.get(key);
    const colors = Object.create(null);
    for (const name of COLORS) colors[name] = colorTokens(name, mode);
    const tokens = {
        theme: mode,
        accent: accentHex,
        accentTint: mixColor(SURFACES[mode].surface, accentHex, mode === 'dark' ? 0.2 : 0.14),
        accentSoft: mixColor(SURFACES[mode].surface, accentHex, mode === 'dark' ? 0.34 : 0.26),
        ...SURFACES[mode],
        ui: UI[mode],
        colors
    };
    cache.set(key, tokens);
    return tokens;
}

export function colorOf(tokens, name) {
    return (typeof name === 'string' && Object.hasOwn(tokens.colors, name) ? tokens.colors[name] : null) ?? tokens.colors.neutral;
}

export function statusColor(status) {
    return (typeof status === 'string' && Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : null) ?? 'neutral';
}

export function brandIconColor(tokens, hex) {
    if (!hex) return tokens.ink;
    const background = tokens.surface;
    return contrastRatio(hex, background) < 1.6 ? tokens.ink : hex;
}

export function cssVariables(tokens) {
    const vars = {
        '--dg-accent': tokens.accent,
        '--dg-accent-tint': tokens.accentTint,
        '--dg-accent-soft': tokens.accentSoft,
        '--dg-canvas': tokens.canvas,
        '--dg-surface': tokens.surface,
        '--dg-raised': tokens.raised,
        '--dg-hover': tokens.hover,
        '--dg-inset': tokens.inset,
        '--dg-ink': tokens.ink,
        '--dg-muted': tokens.muted,
        '--dg-faint': tokens.faint,
        '--dg-edge': tokens.edge,
        '--dg-divider': tokens.divider,
        '--dg-lifeline': tokens.lifeline,
        '--dg-label-bg': tokens.labelBg,
        '--dg-label-text': tokens.labelText,
        '--dg-chip': tokens.chip,
        '--dg-lane': tokens.lane,
        '--dg-lane-header': tokens.laneHeader,
        '--dg-wash-opacity': String(tokens.washOpacity),
        '--dg-lane-opacity': String(tokens.laneOpacity),
        '--dg-dim': String(tokens.dim)
    };
    for (const [name, value] of Object.entries(tokens.ui)) {
        vars[`--ui-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`] = String(value);
    }
    for (const [name, color] of Object.entries(tokens.colors)) {
        vars[`--dg-${name}-solid`] = color.solid;
        vars[`--dg-${name}-text`] = color.text;
        vars[`--dg-${name}-tint`] = color.tint;
        vars[`--dg-${name}-soft`] = color.soft;
    }
    return vars;
}

export function applyTheme(element, theme, accent) {
    const tokens = themeTokens(theme, accent);
    for (const [name, value] of Object.entries(cssVariables(tokens))) element.style.setProperty(name, value);
    element.dataset.dgTheme = tokens.theme;
    return tokens;
}

export function readSiteAccent(doc = globalThis.document) {
    const view = doc?.defaultView;
    if (!view?.getComputedStyle) return null;
    const value = view.getComputedStyle(doc.documentElement).getPropertyValue('--brand-accent').trim();
    return /^#[0-9a-f]{3,6}$/i.test(value) ? value : null;
}
