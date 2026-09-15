import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ContentGenerator } from '../assets/js/content-generator.js';
import { createTranslator } from '../assets/js/spec-loader.js';
import { orderedRoutes, pageGroupMap, pageMarkdown, slug } from '../assets/js/spec-utils.js';

const siteDir = join(import.meta.dirname, '..');
const spec = JSON.parse(readFileSync(join(siteDir, 'config/api-spec.json'), 'utf8'));

function make() {
  return new ContentGenerator({ spec, t: createTranslator(spec) });
}

function parse(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('ContentGenerator', () => {
  let generator;

  beforeAll(() => {
    generator = make();
  });

  it('renders every page and endpoint in the spec', () => {
    const ids = [...Object.keys(spec.pages), ...Object.keys(spec.endpoints ?? {})];
    for (const id of ids) {
      const html = generator.generatePage(id);
      expect(html.length).toBeGreaterThan(200);
      expect(html).not.toContain('undefined');
      expect(parse(html).querySelector('.error-page')).toBeNull();
    }
  });

  it('renders the hero template with stats and buttons', () => {
    const host = parse(generator.generatePage('home'));
    expect(host.querySelector('.hero-title').textContent).toBe(spec.pages.home.content.hero.title);
    expect(host.querySelectorAll('.stat-item')).toHaveLength(spec.pages.home.content.hero.stats.length);
    expect(host.querySelectorAll('.hero-buttons .btn')).toHaveLength(spec.pages.home.content.hero.buttons.length);
  });

  it('renders the endpoint template as a two column layout with panels', () => {
    const host = parse(generator.generatePage('data-endpoint'));
    expect(host.querySelector('.endpoint-grid')).not.toBeNull();
    expect(host.querySelector('.endpoint-page').getAttribute('data-toc-exclude')).toBe('true');
    expect(host.querySelectorAll('.code-panel').length).toBe(2);
    expect(host.querySelector('.playground').hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('.method-badge').textContent.trim()).toBe('POST');
  });

  it('gives every code panel tab a body with a matching id', () => {
    const host = parse(generator.generatePage('data-endpoint'));
    for (const tab of host.querySelectorAll('.code-panel-tab')) {
      expect(host.querySelector(`#${tab.getAttribute('data-panel-target')}`)).not.toBeNull();
    }
  });

  it('renders each block type on the components page', () => {
    const host = parse(generator.generatePage('components'));
    for (const selector of ['.callout', '.cards-grid', '.doc-tabs', '.accordion', '.code-group', '.fields-list', '.table', '.steps-list', '.content-list']) {
      expect(host.querySelector(selector), selector).not.toBeNull();
    }
  });

  it('escapes user content and never emits an inline handler', () => {
    const hostile = {
      ...spec,
      pages: {
        ...spec.pages,
        evil: {
          template: 'content',
          content: {
            title: '<img src=x onerror=alert(1)>',
            sections: [{ title: '"><script>alert(1)</script>', content: '<script>alert(2)</script>', list: ['<b>x</b>'] }],
          },
        },
      },
    };
    const html = new ContentGenerator({ spec: hostile, t: createTranslator(hostile) }).generatePage('evil');
    const host = parse(html);
    expect(host.querySelector('script')).toBeNull();
    for (const element of host.querySelectorAll('*')) {
      for (const attribute of element.attributes) expect(attribute.name.startsWith('on')).toBe(false);
    }
    expect(host.querySelector('.page-title').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelector('.section-title').textContent).toBe('"><script>alert(1)</script>');
  });

  it('sanitizes the prose block instead of escaping it', () => {
    const withProse = {
      ...spec,
      pages: {
        ...spec.pages,
        rich: {
          template: 'content',
          content: {
            title: 'Rich',
            sections: [{ title: 'Rich', prose: '<p>Usa <strong>POST</strong></p><script>alert(1)</script>' }],
          },
        },
      },
    };
    const host = parse(new ContentGenerator({ spec: withProse, t: createTranslator(withProse) }).generatePage('rich'));
    expect(host.querySelector('.section-prose strong').textContent).toBe('POST');
    expect(host.querySelector('script')).toBeNull();
  });

  it('renders an image block with caption', () => {
    const withImage = {
      ...spec,
      pages: {
        ...spec.pages,
        shot: {
          template: 'content',
          content: {
            title: 'Shot',
            sections: [{ title: 'Shot', image: { src: 'docs/a.png', alt: 'Panel', caption: 'El panel' } }],
          },
        },
      },
    };
    const host = parse(new ContentGenerator({ spec: withImage, t: createTranslator(withImage) }).generatePage('shot'));
    expect(host.querySelector('.section-image img').getAttribute('alt')).toBe('Panel');
    expect(host.querySelector('.section-image figcaption').textContent).toBe('El panel');
    expect(host.querySelector('.section-image img').getAttribute('loading')).toBe('lazy');
  });

  it('resolves asset paths through the provided resolver', () => {
    const generatorWithBase = new ContentGenerator({ spec, t: createTranslator(spec), resolveAsset: (path) => `/docs/${path}` });
    const host = parse(generatorWithBase.generatePage('home'));
    expect(host.querySelector('.hero-logo-img').getAttribute('src')).toBe('/docs/logos/logo-hero.svg');
  });

  it('adds breadcrumb, feedback and prev-next to every page but home', () => {
    const home = parse(generator.generatePage('home'));
    expect(home.querySelector('.page-topbar')).toBeNull();
    const page = parse(generator.generatePage('authentication'));
    expect(page.querySelector('.breadcrumb-current').textContent).toBe('Autenticación');
    expect(page.querySelector('.feedback')).not.toBeNull();
    expect(page.querySelectorAll('.page-nav-link').length).toBeGreaterThan(0);
  });

  it('orders prev and next by the sidebar order', () => {
    const routes = orderedRoutes(spec);
    const index = routes.findIndex((route) => route.id === 'authentication');
    const host = parse(generator.generatePage('authentication'));
    expect(host.querySelector('.page-nav-prev .page-nav-title').textContent).toBe(routes[index - 1].title);
    expect(host.querySelector('.page-nav-next .page-nav-title').textContent).toBe(routes[index + 1].title);
  });

  it('builds a sidebar whose groups match the navbar tabs', () => {
    const host = parse(generator.generateSidebar());
    const groups = [...host.querySelectorAll('.sidebar-section')].map((section) => section.getAttribute('data-group'));
    expect(groups[0]).toBe('nav_guides');
    for (const tab of spec.site_config.navbar.tabs) {
      for (const group of tab.groups) expect(groups).toContain(group);
    }
  });

  it('maps every route to a sidebar group', () => {
    const map = pageGroupMap(spec);
    for (const route of orderedRoutes(spec)) expect(map[route.id]).toBeTruthy();
  });

  it('anchors section headings the same way the search index does', () => {
    const host = parse(generator.generatePage('getting-started'));
    const first = spec.pages['getting-started'].content.sections[0].title;
    expect(host.querySelector('.section-title').textContent).toBe(first);
    expect(slug(first)).toBe('resumen');
  });

  it('shows the environment banner only where the spec asks for it', () => {
    expect(parse(generator.generatePage('home')).querySelector('.endpoint-banner')).toBeNull();
    expect(parse(generator.generatePage('getting-started')).querySelector('.endpoint-banner')).toBeNull();
    expect(parse(generator.generatePage('components')).querySelector('.endpoint-banner')).not.toBeNull();
    expect(parse(generator.generatePage('data-endpoint')).querySelector('.endpoint-banner')).toBeNull();
  });

  it('falls back to a not found page for unknown routes', () => {
    const host = parse(generator.generatePage('ghost'));
    expect(host.querySelector('.error-page')).not.toBeNull();
  });

  it('produces markdown that mirrors the rendered page', () => {
    const markdown = pageMarkdown(spec, 'getting-started');
    for (const section of spec.pages['getting-started'].content.sections) {
      expect(markdown).toContain(`## ${section.title}`);
    }
  });
});
