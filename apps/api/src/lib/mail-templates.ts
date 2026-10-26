import type { MailMessage } from './mail.js';

export type Template = Omit<MailMessage, 'to'>;

const ROLE_LABEL: Record<string, string> = {
  owner: 'dueña o dueño',
  admin: 'administración',
  member: 'miembro',
};

export const roleLabel = (role: string): string => ROLE_LABEL[role] ?? 'miembro';

const IGNORE_IF_NOT_YOU = 'Si no fuiste tú, cambia tu contraseña de inmediato y avisa a quien administra el espacio de trabajo.';

export const templates = {
  invitation: (options: { workspace: string; inviter: string; role: string; url: string; expiresInDays: number }): Template => ({
    subject: `Te invitaron a ${options.workspace}`,
    heading: `Te invitaron a ${options.workspace}`,
    body: [
      `${options.inviter} te invitó a colaborar en la documentación de ${options.workspace}.`,
      `Tu rol será: ${roleLabel(options.role)}.`,
      `El enlace funciona una sola vez y vence en ${options.expiresInDays} días.`,
    ],
    action: { label: 'Aceptar la invitación', url: options.url },
    footer: 'Si no esperabas esta invitación, puedes ignorar este correo.',
  }),

  invitationAccepted: (options: { workspace: string; who: string; email: string }): Template => ({
    subject: `${options.who} aceptó tu invitación`,
    heading: `${options.who} ya está en ${options.workspace}`,
    body: [`La invitación que enviaste a ${options.email} fue aceptada.`],
  }),

  welcome: (options: { workspace: string; url: string }): Template => ({
    subject: `Bienvenido a ${options.workspace}`,
    heading: `Ya eres parte de ${options.workspace}`,
    body: ['Tu cuenta quedó lista. Desde el studio puedes escribir, revisar y publicar documentación.'],
    action: { label: 'Entrar al studio', url: options.url },
  }),

  passwordReset: (options: { url: string; expiresInMinutes: number }): Template => ({
    subject: 'Restablece tu contraseña',
    heading: 'Restablece tu contraseña',
    body: [
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
      `El enlace funciona una sola vez y vence en ${options.expiresInMinutes} minutos.`,
    ],
    action: { label: 'Elegir una contraseña nueva', url: options.url },
    footer: 'Si no lo pediste, ignora este correo: tu contraseña no cambia.',
  }),

  passwordChanged: (options: { workspace: string }): Template => ({
    subject: 'Tu contraseña cambió',
    heading: 'Tu contraseña cambió',
    body: [`Se actualizó la contraseña de tu cuenta en ${options.workspace} y cerramos tus otras sesiones.`],
    footer: IGNORE_IF_NOT_YOU,
  }),

  roleChanged: (options: { workspace: string; role: string; by: string }): Template => ({
    subject: `Tu rol en ${options.workspace} cambió`,
    heading: 'Tu rol cambió',
    body: [`${options.by} cambió tu rol en ${options.workspace}. Ahora tu rol es: ${roleLabel(options.role)}.`],
  }),

  memberRemoved: (options: { workspace: string }): Template => ({
    subject: `Ya no tienes acceso a ${options.workspace}`,
    heading: `Ya no tienes acceso a ${options.workspace}`,
    body: ['Tu acceso al espacio de trabajo fue retirado y tus sesiones se cerraron.', 'Si crees que es un error, contacta a quien lo administra.'],
  }),

  newLogin: (options: { workspace: string; when: string; device: string }): Template => ({
    subject: 'Nuevo inicio de sesión en tu cuenta',
    heading: 'Detectamos un inicio de sesión nuevo',
    body: [
      `Alguien entró a tu cuenta de ${options.workspace} desde un dispositivo que no habíamos visto.`,
      `Fecha: ${options.when}.`,
      `Dispositivo: ${options.device}.`,
    ],
    footer: IGNORE_IF_NOT_YOU,
  }),

  published: (options: { portal: string; pages: number; url?: string }): Template => ({
    subject: `Se publicó ${options.portal}`,
    heading: `${options.portal} está publicado`,
    body: [`Se publicaron ${options.pages} páginas.`],
    ...(options.url ? { action: { label: 'Ver el portal', url: options.url } } : {}),
  }),

  publishFailed: (options: { portal: string }): Template => ({
    subject: `No se pudo publicar ${options.portal}`,
    heading: `La publicación de ${options.portal} no se completó`,
    body: ['Revisa el destino de publicación en el studio y vuelve a intentarlo.'],
  }),
};
