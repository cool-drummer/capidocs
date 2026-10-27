import { describe, expect, it } from 'vitest';
import { COLORS } from '../../assets/js/diagram/model.js';
import { applyTheme, contrastRatio, cssVariables, themeTokens } from '../../assets/js/diagram/theme.js';
import { createDiagramTranslator, friendlyError } from '../../assets/js/diagram/i18n.js';

describe('diagram theme', () => {
  it.each(['light', 'dark'])('meets AA contrast for text in the %s theme', (theme) => {
    const tokens = themeTokens(theme);
    const pairs = [
      [tokens.ink, tokens.surface],
      [tokens.muted, tokens.surface],
      [tokens.muted, tokens.canvas],
      [tokens.labelText, tokens.labelBg],
      [tokens.ink, tokens.lane],
      [tokens.ui.ink, tokens.ui.page],
      [tokens.ui.muted, tokens.ui.page],
      [tokens.ui.muted, tokens.ui.well],
      [tokens.ui.overlayInk, tokens.ui.overlay],
      [tokens.ui.overlayMuted, tokens.ui.overlay],
      [tokens.ui.onStrong, tokens.ui.strong],
    ];
    for (const [text, background] of pairs) expect(contrastRatio(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    for (const name of COLORS) {
      const color = tokens.colors[name];
      expect(contrastRatio(color.text, color.tint), `${name} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.text, color.soft), `${name} text on soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color.solid, tokens.surface), `${name} solid`).toBeGreaterThanOrEqual(3);
    }
  });

  it('exposes a CSS variable for every palette color', () => {
    const vars = cssVariables(themeTokens('dark'));
    for (const name of COLORS) {
      for (const role of ['solid', 'text', 'tint', 'soft']) expect(vars[`--dg-${name}-${role}`], `${name} ${role}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(vars['--ui-overlay-ink']).toBe('#f4f4f1');
    expect(vars['--dg-on-accent']).toBe('#0b0b0c');
    expect(cssVariables(themeTokens('light'))['--dg-on-accent']).toBe('#ffffff');
  });

  it('applies the tokens through the CSSOM', () => {
    const element = document.createElement('div');
    applyTheme(element, 'dark');
    expect(element.dataset.dgTheme).toBe('dark');
    expect(element.style.getPropertyValue('--dg-canvas')).toBe('#0b0b0d');
    expect(element.getAttribute('style')).toContain('--dg-accent');
  });

  it('uses the brand accent when one is given', () => {
    expect(themeTokens('light', { light: '#123456', dark: '#abcdef' }).accent).toBe('#123456');
    expect(themeTokens('dark').accent).toBe('#ecee8b');
  });
});

describe('diagram translations', () => {
  it('speaks Spanish by default and English on request', () => {
    expect(createDiagramTranslator()('viewer.zoomIn')).toBe('Acercar');
    expect(createDiagramTranslator('en-US')('viewer.zoomIn')).toBe('Zoom in');
    expect(createDiagramTranslator('fr')('viewer.zoomIn')).toBe('Acercar');
  });

  it('pluralizes and interpolates', () => {
    const t = createDiagramTranslator('es');
    expect(t('gallery.nodes', { count: 1 })).toBe('1 nodo');
    expect(t('gallery.nodes', { count: 4 })).toBe('4 nodos');
    expect(t('steps.counter', { current: 2, total: 5 })).toBe('2 de 5');
  });

  it('maps error codes to friendly messages and never echoes technical text', () => {
    const t = createDiagramTranslator('es');
    for (const code of ['unsupported_format', 'invalid_json', 'invalid_model', 'too_large', 'empty', 'parse_error']) {
      const message = friendlyError(t, { code });
      expect(message).not.toBe(`errors.${code}`);
      expect(message).not.toContain(code);
    }
    expect(friendlyError(t, new Error('SyntaxError: Unexpected token < in JSON'))).toBe(t('errors.generic'));
  });

  it('has the same keys in both languages', () => {
    const es = createDiagramTranslator('es');
    const en = createDiagramTranslator('en');
    for (const key of ['import.drop', 'export.pdfAll', 'inspector.openDetail', 'storage.remove', 'errors.too_large']) {
      expect(en(key)).not.toBe(es(key));
    }
  });
});
