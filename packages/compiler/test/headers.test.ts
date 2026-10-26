import { describe, expect, it } from 'vitest';
import type { Spec } from '@capidocs/spec';
import { buildContentSecurityPolicy, buildHeaders, collectOrigins } from '../src/headers.js';

const baseSpec = (overrides: Partial<Spec['site_config']> = {}, pages: Spec['pages'] = {}): Spec => ({
  site_config: { name: 'Demo', ...overrides },
  pages: {
    home: { template: 'hero', content: { hero: { title: 'Demo' } } },
    ...pages,
  },
});

describe('content security policy', () => {
  it('stays on self when the spec references nothing external', () => {
    const policy = buildContentSecurityPolicy([baseSpec()]);
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("style-src 'self';");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('allows the origins the spec actually uses', () => {
    const spec: Spec = {
      ...baseSpec(
        {
          access: { mode: 'gate', endpoint: 'https://gate.example.com/check?x=1' },
          theme: { fonts: { imports: ['https://fonts.googleapis.com/css2?family=Inter'] } },
          logos: { navbar_light: 'https://cdn.example.org/logo.svg', navbar_dark: 'logos/dark.svg' },
        },
        {
          guide: {
            template: 'content',
            content: {
              title: 'Guide',
              sections: [
                { title: 'Image', image: { src: 'https://images.example.net/a.png' } },
                { title: 'Prose', prose: '<p><img src="https://media.example.io/b.png" alt=""></p>' },
              ],
            },
          },
        },
      ),
      api: { base_url: 'https://api.example.com/v1' },
    };
    const origins = collectOrigins([spec]);
    expect([...origins.connect].sort()).toEqual(['https://api.example.com', 'https://gate.example.com']);
    expect([...origins.style]).toEqual(['https://fonts.googleapis.com']);
    expect([...origins.font]).toEqual(['https://fonts.gstatic.com']);
    expect([...origins.img].sort()).toEqual(['https://cdn.example.org', 'https://images.example.net', 'https://media.example.io']);
  });

  it('ignores relative paths and non-http schemes', () => {
    const spec: Spec = { ...baseSpec({ logos: { icon: 'javascript:alert(1)', hero: 'logos/hero.svg' } }), api: { base_url: '/api' } };
    const origins = collectOrigins([spec]);
    expect(origins.img.size).toBe(0);
    expect(origins.connect.size).toBe(0);
  });

  it('merges origins across language and version specs', () => {
    const first: Spec = { ...baseSpec(), api: { base_url: 'https://api.one.test' } };
    const second: Spec = { ...baseSpec(), api: { base_url: 'https://api.two.test' } };
    expect(buildContentSecurityPolicy([first, second])).toContain("connect-src 'self' https://api.one.test https://api.two.test");
  });

  it('renders a _headers block for every path', () => {
    const headers = buildHeaders([baseSpec()]);
    expect(headers.startsWith('/*\n')).toBe(true);
    expect(headers).toContain('  X-Content-Type-Options: nosniff');
    expect(headers).toContain('  X-Frame-Options: DENY');
    expect(headers).toContain('  Content-Security-Policy: ');
  });
});
