import { describe, expect, it } from 'vitest';
import { BUILTIN_ICONS } from '../../assets/js/diagram/icons.js';

const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+\-.,\s]+$/;
const VIEWBOX = /^-?\d+(?:\.\d+)?(?:[ ,]+-?\d+(?:\.\d+)?){3}$/;

const REQUIRED = [
  'brand:cloudflare', 'brand:digitalocean', 'brand:github', 'brand:githubactions', 'brand:laravel',
  'brand:nginx', 'brand:php', 'brand:postgresql', 'brand:redis', 'brand:ubuntu',
  'activity', 'alert-triangle', 'archive', 'audio-lines', 'bell', 'briefcase', 'building', 'chart-bar',
  'check-circle', 'clipboard', 'clock', 'cloud', 'code', 'cpu', 'database', 'door-open', 'download', 'eye',
  'file-text', 'filter', 'fingerprint', 'folder-lock', 'gauge', 'git-branch', 'globe', 'handshake',
  'hard-drive', 'hash', 'history', 'id-card', 'inbox', 'key', 'layers', 'link', 'list-checks', 'lock',
  'log-in', 'mail', 'mic', 'monitor', 'network', 'presentation', 'receipt', 'refresh-cw', 'rocket', 'route',
  'scale', 'scan-line', 'search', 'send', 'server', 'settings', 'shield', 'smartphone', 'table', 'tag',
  'terminal', 'timer', 'trash', 'upload', 'user', 'user-check', 'user-cog', 'users', 'workflow', 'zap',
];

const INTERFACE = [
  'chevron-down', 'chevron-right', 'chevron-up', 'arrow-up-right', 'external-link', 'minus', 'plus', 'scan',
  'skip-back', 'skip-forward', 'play', 'pause', 'x', 'sun', 'moon', 'panel-left', 'panel-right', 'maximize',
  'minimize', 'pen-tool', 'image', 'file-image', 'file-code', 'file-json', 'book-open', 'locate', 'box',
  'arrow-left-right', 'arrow-right', 'layout-grid', 'mouse-pointer-click', 'file', 'key', 'link', 'fingerprint',
  'user', 'database', 'inbox', 'globe', 'table',
];

describe('built-in icons', () => {
  it('ships all 76 icons the diagram sets rely on', () => {
    expect(REQUIRED).toHaveLength(76);
    const missing = REQUIRED.filter((name) => !BUILTIN_ICONS[name]);
    expect(missing).toEqual([]);
  });

  it('ships every icon the viewer and explorer draw', () => {
    expect(INTERFACE.filter((name) => !BUILTIN_ICONS[name])).toEqual([]);
  });

  it('keeps every icon inside the path alphabet accepted by the model', () => {
    for (const [name, icon] of Object.entries(BUILTIN_ICONS)) {
      expect(VIEWBOX.test(icon.viewBox), name).toBe(true);
      expect(icon.paths.length, name).toBeGreaterThan(0);
      for (const path of icon.paths) expect(PATH_DATA.test(path), `${name}: ${path}`).toBe(true);
    }
  });

  it('paints line icons with a stroke and brands with their official fill color', () => {
    for (const [name, icon] of Object.entries(BUILTIN_ICONS)) {
      if (name.startsWith('brand:')) {
        expect(icon.stroke, name).toBe(false);
        expect(icon.color, name).toMatch(/^#[0-9A-Fa-f]{6}$/);
      } else {
        expect(icon.stroke, name).toBe(true);
      }
    }
  });
});
