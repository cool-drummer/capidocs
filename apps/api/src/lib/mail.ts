export interface MailMessage {
  to: string;
  subject: string;
  heading: string;
  body: string[];
  action?: { label: string; url: string };
  footer?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

export interface MailSettings {
  transport: 'resend' | 'console';
  apiKey: string | null;
  from: string | null;
  brand: string;
}

export interface MailLogger {
  info: (data: Record<string, unknown>, message: string) => void;
  error: (data: Record<string, unknown>, message: string) => void;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function renderHtml(message: MailMessage, brand: string): string {
  const paragraphs = message.body.map((line) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(line)}</p>`).join('');
  const action = message.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(message.action.url)}" style="display:inline-block;background:#5b5f12;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(message.action.label)}</a></p>`
    : '';
  const footer = message.footer ? `<p style="margin:24px 0 0;color:#6d7277;font-size:13px;line-height:1.5">${escapeHtml(message.footer)}</p>` : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7f8f8;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px 28px">
    <p style="margin:0 0 24px;font-weight:600;color:#4d500f">${escapeHtml(brand)}</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(message.heading)}</h1>
    ${paragraphs}${action}${footer}
  </div>
</body></html>`;
}

export function renderText(message: MailMessage): string {
  const parts = [message.heading, '', ...message.body];
  if (message.action) parts.push('', `${message.action.label}: ${message.action.url}`);
  if (message.footer) parts.push('', message.footer);
  return parts.join('\n');
}

export function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function createMailer(settings: MailSettings, logger: MailLogger): Mailer {
  if (settings.transport === 'console') {
    let count = 0;
    return {
      async send(message) {
        count += 1;
        logger.info({ mail: { to: message.to, subject: message.subject, text: renderText(message) } }, 'mail printed by the console transport');
        return { id: `console-${count}` };
      },
    };
  }

  if (!settings.apiKey || !settings.from) throw new Error('resend transport needs an API key and a sender');
  const apiKey = settings.apiKey;
  const from = settings.from;

  return {
    async send(message) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: renderHtml(message, settings.brand),
          text: renderText(message),
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.error({ status: response.status, to: maskAddress(message.to) }, 'mail provider rejected the message');
        throw new Error(`mail provider responded ${response.status}`);
      }
      const payload = (await response.json()) as { id?: string };
      return { id: payload.id ?? 'sent' };
    },
  };
}
