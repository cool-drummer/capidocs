import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer, renderHtml, renderText, type MailMessage } from '../src/lib/mail.js';
import { templates } from '../src/lib/mail-templates.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function recorder() {
  const entries: { level: string; data: Record<string, unknown>; message: string }[] = [];
  return {
    entries,
    logger: {
      info: (data: Record<string, unknown>, message: string) => entries.push({ level: 'info', data, message }),
      error: (data: Record<string, unknown>, message: string) => entries.push({ level: 'error', data, message }),
    },
  };
}

const sample = (): MailMessage => ({
  to: 'ana@example.com',
  ...templates.invitation({ workspace: 'Acme', inviter: 'Dan', role: 'member', url: 'https://studio.test/#invitation=abc', expiresInDays: 7 }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mail rendering', () => {
  it('escapes user text in the html body', () => {
    const html = renderHtml({ to: 'x@y.z', ...templates.invitation({ workspace: '<script>', inviter: 'A & B', role: 'member', url: 'https://x.test', expiresInDays: 7 }) }, 'Capidocs');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('writes a plain text version with the link', () => {
    expect(renderText(sample())).toContain('https://studio.test/#invitation=abc');
  });

  it('uses neither borders nor shadows in the layout', () => {
    expect(renderHtml(sample(), 'Capidocs')).not.toMatch(/border(?!-radius)|shadow|gradient|blur/i);
  });
});

describe('templates', () => {
  const all = [
    templates.invitation({ workspace: 'Acme', inviter: 'Dan', role: 'admin', url: 'https://x.test', expiresInDays: 7 }),
    templates.invitationAccepted({ workspace: 'Acme', who: 'Ana', email: 'ana@example.com' }),
    templates.welcome({ workspace: 'Acme', url: 'https://x.test' }),
    templates.passwordReset({ url: 'https://x.test', expiresInMinutes: 30 }),
    templates.passwordChanged({ workspace: 'Acme' }),
    templates.roleChanged({ workspace: 'Acme', role: 'admin', by: 'Dan' }),
    templates.memberRemoved({ workspace: 'Acme' }),
    templates.newLogin({ workspace: 'Acme', when: '26 de octubre de 2026, 10:00', device: 'Chrome en macOS' }),
    templates.published({ portal: 'Docs', pages: 3 }),
    templates.publishFailed({ portal: 'Docs' }),
  ];

  it('are written in spanish without emojis or shouting', () => {
    for (const template of all) {
      const text = [template.subject, template.heading, ...template.body, template.footer ?? ''].join(' ');
      expect(text).not.toMatch(EMOJI);
      expect(template.subject).not.toBe(template.subject.toUpperCase());
    }
  });

  it('never leak technical detail', () => {
    expect(JSON.stringify(all)).not.toMatch(/stack|error:|sql|ECONN|undefined|null/i);
  });

  it('name the role in words', () => {
    expect(templates.roleChanged({ workspace: 'Acme', role: 'admin', by: 'Dan' }).body.join(' ')).toContain('administración');
  });
});

describe('console transport', () => {
  it('prints the message instead of sending it', async () => {
    const log = recorder();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const mailer = createMailer({ transport: 'console', apiKey: null, from: null, brand: 'Capidocs' }, log.logger);
    await mailer.send(sample());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.entries[0]!.message).toBe('mail printed by the console transport');
  });
});

describe('resend transport', () => {
  const settings = { transport: 'resend' as const, apiKey: 're_secret_value', from: 'Studio <studio@example.com>', brand: 'Capidocs' };

  it('sends html and text with the configured sender', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const mailer = createMailer(settings, recorder().logger);
    await expect(mailer.send(sample())).resolves.toEqual({ id: 'email-1' });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ from: settings.from, to: 'ana@example.com' });
    expect(payload.html).toContain('Aceptar la invitación');
    expect(payload.text).toContain('https://studio.test/#invitation=abc');
  });

  it('logs a failure without the key, the link or the full address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"invalid"}', { status: 422 })));
    const log = recorder();
    const mailer = createMailer(settings, log.logger);
    await expect(mailer.send(sample())).rejects.toThrow('mail provider responded 422');
    const logged = JSON.stringify(log.entries);
    expect(logged).not.toContain('re_secret_value');
    expect(logged).not.toContain('invitation=abc');
    expect(logged).not.toContain('ana@example.com');
    expect(logged).toContain('a***@example.com');
  });

  it('refuses to start without credentials', () => {
    expect(() => createMailer({ ...settings, apiKey: null }, recorder().logger)).toThrow();
  });
});
