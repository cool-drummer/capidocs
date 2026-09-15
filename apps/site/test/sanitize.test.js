import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../assets/js/sanitize.js';
import { escapeHtml } from '../assets/js/escape.js';
import { brandCss, mix, rgba } from '../assets/js/theme.js';

describe('sanitizeHtml', () => {
  const cases = [
    ['<script>alert(1)</script><p>ok</p>', 'script'],
    ['<img src=x onerror=alert(1)>', 'onerror'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'data:'],
    ['<p onclick="alert(1)">x</p>', 'onclick'],
    ['<iframe src="https://evil.test"></iframe>', 'iframe'],
    ['<svg><script>alert(1)</script></svg>', 'svg'],
    ['<style>body{display:none}</style>', 'style'],
    ['<form action="/x"><input name="p"></form>', 'form'],
    ['<a href="vbscript:msgbox(1)">x</a>', 'vbscript'],
    ['<p><a href="JaVaScRiPt:alert(1)">x</a></p>', 'avascript'],
    ['<base href="https://evil.test">', 'base'],
  ];

  it.each(cases)('removes the dangerous construct in %s', (input, needle) => {
    const output = sanitizeHtml(input);
    expect(output.toLowerCase()).not.toContain(needle.toLowerCase());
  });

  it('keeps allowed formatting and inline code', () => {
    const output = sanitizeHtml('<p>Usa <strong>POST</strong> con <code class="language-json">{"a":1}</code></p>');
    expect(output).toContain('<strong>POST</strong>');
    expect(output).toContain('class="language-json"');
  });

  it('keeps safe links and marks external ones', () => {
    const output = sanitizeHtml('<a href="https://example.com">x</a><a href="#home">y</a>');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).toContain('href="#home"');
  });

  it('unwraps unknown tags but keeps their text', () => {
    expect(sanitizeHtml('<marquee>hola</marquee>')).toBe('hola');
  });

  it('drops class values that are not a language hint', () => {
    expect(sanitizeHtml('<code class="evil">x</code>')).toBe('<code>x</code>');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes every html-significant character', () => {
    expect(escapeHtml(`<&">'`)).toBe('&lt;&amp;&quot;&gt;&#39;');
  });

  it('treats null and undefined as empty', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('theme', () => {
  it('derives tint and border colors from the accent', () => {
    expect(rgba('#4bb3a1', 0.14)).toBe('rgba(75, 179, 161, 0.14)');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('emits both theme blocks and font variables', () => {
    const css = brandCss({ accent: { light: '#2f8f90', dark: '#4bb3a1' }, fonts: { sans: 'Inter, sans-serif' } });
    expect(css).toContain(':root {');
    expect(css).toContain('[data-theme="light"] {');
    expect(css).toContain('--brand-accent: #4bb3a1;');
    expect(css).toContain('--brand-accent: #2f8f90;');
    expect(css).toContain('--font-sans: Inter, sans-serif;');
  });

  it('returns nothing without a theme', () => {
    expect(brandCss(undefined)).toBe('');
    expect(brandCss({})).toBe('');
  });
});
