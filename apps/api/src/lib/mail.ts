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
  sent: MailMessage[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function renderHtml(message: MailMessage, brand: string): string {
  const paragraphs = message.body.map((line) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(line)}</p>`).join('');
  const action = message.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(message.action.url)}" style="display:inline-block;background:#2f8f90;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${escapeHtml(message.action.label)}</a></p>`
    : '';
  const footer = message.footer ? `<p style="margin:24px 0 0;color:#6d7277;font-size:13px;line-height:1.5">${escapeHtml(message.footer)}</p>` : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7f8f8;padding:32px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px 28px">
    <p style="margin:0 0 24px;font-weight:600;color:#226d6e">${escapeHtml(brand)}</p>
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

export function createMailer(options: { apiKey?: string; from?: string; brand?: string; logger?: (message: string) => void }): Mailer {
  const sent: MailMessage[] = [];
  const brand = options.brand ?? 'Capidocs';
  const log = options.logger ?? (() => undefined);

  return {
    sent,
    async send(message) {
      sent.push(message);
      if (!options.apiKey || !options.from) {
        log(`mail not sent (no provider configured): ${message.subject} -> ${message.to}`);
        return { id: 'logged' };
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          html: renderHtml(message, brand),
          text: renderText(message),
        }),
      });
      if (!response.ok) {
        log(`mail provider failed with ${response.status} for ${message.to}`);
        throw new Error(`mail provider responded ${response.status}`);
      }
      const payload = (await response.json()) as { id?: string };
      return { id: payload.id ?? 'sent' };
    },
  };
}

export const templates = {
  invitation: (options: { workspace: string; inviter: string; url: string; role: string }): Omit<MailMessage, 'to'> => ({
    subject: `Te invitaron a ${options.workspace}`,
    heading: `Te invitaron a ${options.workspace}`,
    body: [
      `${options.inviter} te invitó a colaborar en la documentación de ${options.workspace}.`,
      `Tu rol será: ${options.role}.`,
    ],
    action: { label: 'Aceptar la invitación', url: options.url },
    footer: 'Si no esperabas esta invitación, puedes ignorar este correo.',
  }),

  welcome: (options: { workspace: string; url: string }): Omit<MailMessage, 'to'> => ({
    subject: `Bienvenido a ${options.workspace}`,
    heading: `Ya eres parte de ${options.workspace}`,
    body: ['Tu cuenta quedó lista. Desde aquí puedes escribir, revisar y publicar documentación.'],
    action: { label: 'Entrar al studio', url: options.url },
  }),

  invitationAccepted: (options: { workspace: string; who: string }): Omit<MailMessage, 'to'> => ({
    subject: `${options.who} aceptó tu invitación`,
    heading: `${options.who} ya está en ${options.workspace}`,
    body: ['La invitación que enviaste fue aceptada.'],
  }),

  passwordChanged: (options: { workspace: string }): Omit<MailMessage, 'to'> => ({
    subject: 'Tu contraseña cambió',
    heading: 'Cambiaste tu contraseña',
    body: [`Se actualizó la contraseña de tu cuenta en ${options.workspace}.`],
    footer: 'Si no fuiste tú, cambia tu contraseña de inmediato y avisa a quien administra el espacio.',
  }),

  published: (options: { portal: string; pages: number; url?: string }): Omit<MailMessage, 'to'> => ({
    subject: `Se publicó ${options.portal}`,
    heading: `${options.portal} está publicado`,
    body: [`Se publicaron ${options.pages} páginas.`],
    ...(options.url ? { action: { label: 'Ver el portal', url: options.url } } : {}),
  }),

  publishFailed: (options: { portal: string }): Omit<MailMessage, 'to'> => ({
    subject: `No se pudo publicar ${options.portal}`,
    heading: `La publicación de ${options.portal} no se completó`,
    body: ['Revisa el destino de publicación en el studio y vuelve a intentarlo.'],
  }),
};
