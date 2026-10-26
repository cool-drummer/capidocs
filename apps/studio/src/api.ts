export interface Workspace {
  id: string;
  name: string;
  slug: string;
  defaultLocale: string;
  locales: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceRole: 'owner' | 'admin' | 'member';
}

export interface Space {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  audience: 'public' | 'customers' | 'internal';
  portalId: string | null;
  role: 'admin' | 'writer' | 'reader' | null;
}

export interface Portal {
  id: string;
  name: string;
  slug: string;
  siteUrl: string | null;
  locales: string[];
  accessMode: 'open' | 'gate' | 'accounts';
  brand: Record<string, unknown>;
  deployTarget: Record<string, unknown>;
}

export interface TreeNode {
  id: string;
  slugId: string;
  title: string;
  kind: 'page' | 'hero' | 'endpoint' | 'feature';
  icon: string | null;
  position: string;
  parentPageId: string | null;
  hasDraft: boolean;
  publishedAt: string | null;
  children: TreeNode[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  lastLoginAt: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export interface SpaceMember {
  id: string;
  userId: string | null;
  groupId: string | null;
  role: 'admin' | 'writer' | 'reader';
  name: string | null;
  email: string | null;
}

export interface Attachment {
  id: string;
  url: string;
  fileName: string;
  size: number;
  mime: string;
}

export interface PageContent {
  id: string;
  pageId: string;
  locale: string;
  title: string;
  content: unknown;
}

const GENERIC_ERROR = 'Algo salió mal, inténtalo de nuevo en un momento.';

const MESSAGE_BY_CODE: Record<string, string> = {
  network: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  invalid_json: 'Ese texto no es un JSON válido.',
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  401: 'Tu sesión terminó. Inicia sesión de nuevo.',
  403: 'No tienes permiso para hacer esto.',
  404: 'No encontramos lo que buscas.',
  409: 'Ese valor ya está en uso. Elige otro.',
  413: 'El archivo o el contenido es demasiado grande.',
  429: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function clientError(code: keyof typeof MESSAGE_BY_CODE): ApiError {
  return new ApiError(0, code, MESSAGE_BY_CODE[code] ?? GENERIC_ERROR);
}

export function friendlyError(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR;
}

function errorFrom(status: number, payload: Record<string, unknown>): ApiError {
  const structured = typeof payload.error === 'string' && typeof payload.message === 'string';
  const code = structured ? String(payload.error) : `http_${status}`;
  const message = MESSAGE_BY_CODE[code] ?? (structured && status < 500 ? String(payload.message) : undefined) ?? MESSAGE_BY_STATUS[status] ?? GENERIC_ERROR;
  return new ApiError(status, code, message);
}

const BASE = '/api';
let csrfToken = '';
let sessionEnded: (() => void) | null = null;

export function whenSessionEnds(handler: () => void): void {
  sessionEnded = handler;
}

function remember<T>(payload: T): T {
  const token = (payload as { csrfToken?: unknown }).csrfToken;
  if (typeof token === 'string') csrfToken = token;
  return payload;
}

function headersFor(method: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

function parseJson(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function send(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(BASE + path, { credentials: 'same-origin', ...init });
  } catch {
    throw clientError('network');
  }
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    if (response.status === 401 && path !== '/me' && !path.startsWith('/auth/') && !path.startsWith('/invitations/')) sessionEnded?.();
    throw errorFrom(response.status, payload);
  }
  return payload;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const payload = await send(path, {
    method,
    headers: headersFor(method, body ? 'application/json' : undefined),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return payload as T;
}

export const api = {
  me: () => request<{ user: SessionUser; workspace: Workspace; csrfToken: string }>('GET', '/me').then(remember),
  setup: (body: Record<string, unknown>) => request<{ workspace: Workspace }>('POST', '/auth/setup', body),
  login: (email: string, password: string) =>
    request<{ user: SessionUser; csrfToken: string }>('POST', '/auth/login', { email, password }).then(remember),
  logout: () =>
    request<{ ok: boolean }>('POST', '/auth/logout').finally(() => {
      csrfToken = '';
    }),

  spaces: () => request<{ spaces: Space[] }>('GET', '/spaces'),
  createSpace: (body: Record<string, unknown>) => request<{ space: Space }>('POST', '/spaces', body),
  tree: (spaceId: string, locale?: string) =>
    request<{ tree: TreeNode[]; locale: string; locales: string[] }>(
      'GET',
      `/spaces/${spaceId}/tree${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`,
    ),
  createPage: (spaceId: string, body: Record<string, unknown>) =>
    request<{ page: { id: string } }>('POST', `/spaces/${spaceId}/pages`, body),

  page: (pageId: string, locale?: string) =>
    request<{ page: TreeNode & { spaceId: string; isLocked: boolean }; content: PageContent | null; locale: string; locales: string[]; canEdit: boolean }>(
      'GET',
      `/pages/${pageId}${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`,
    ),
  saveContent: (pageId: string, locale: string, title: string, document: unknown) =>
    request<{ ok: boolean }>('PUT', `/pages/${pageId}/content`, { locale, title, document }),
  publishPage: (pageId: string, locale: string) =>
    request<{ version: { version: number } }>('POST', `/pages/${pageId}/publish`, { locale }),
  movePage: (pageId: string, parentPageId: string | null, index: number) =>
    request<{ page: TreeNode }>('POST', `/pages/${pageId}/move`, { parentPageId, index }),
  deletePage: (pageId: string) => request<{ removed: number }>('DELETE', `/pages/${pageId}`),

  portals: () => request<{ portals: Portal[] }>('GET', '/portals'),
  createPortal: (body: Record<string, unknown>) => request<{ portal: Portal }>('POST', '/portals', body),
  updatePortal: (portalId: string, body: Record<string, unknown>) =>
    request<{ portal: Portal }>('PUT', `/portals/${portalId}`, body),
  publishPortal: (portalId: string) =>
    request<{ status: string; routes: number; locales: string[]; output: { url?: string; detail?: string } }>(
      'POST',
      `/portals/${portalId}/publish`,
    ),
  previewPortal: (portalId: string) =>
    request<{ specs: { locale: string; spec: unknown }[] }>('GET', `/portals/${portalId}/preview`),
  importPortal: (spec: unknown, name?: string) =>
    request<{ portalId: string; portalName: string; spaces: { name: string; pages: number }[]; warnings: string[] }>(
      'POST',
      '/portals/import',
      { spec, ...(name ? { name } : {}) },
    ),

  members: () => request<{ members: Member[]; invitations: Invitation[] }>('GET', '/members'),
  invite: (email: string, role: 'admin' | 'member') =>
    request<{ invitation: Invitation }>('POST', '/members/invitations', { email, role }),
  revokeInvitation: (id: string) => request<{ ok: boolean }>('DELETE', `/members/invitations/${id}`),
  setMemberRole: (userId: string, role: 'admin' | 'member') => request<{ ok: boolean }>('PUT', `/members/${userId}`, { role }),
  removeMember: (userId: string) => request<{ ok: boolean }>('DELETE', `/members/${userId}`),
  invitation: (token: string) => request<{ email: string; role: string; workspace: string }>('POST', '/invitations/inspect', { token }),
  acceptInvitation: (token: string, name: string, password: string) =>
    request<{ workspace: string; csrfToken: string }>('POST', '/invitations/accept', { token, name, password }).then(remember),

  spaceMembers: (spaceId: string) => request<{ members: SpaceMember[] }>('GET', `/spaces/${spaceId}/members`),
  setSpaceMember: (spaceId: string, userId: string, role: 'admin' | 'writer' | 'reader') =>
    request<{ ok: boolean }>('PUT', `/spaces/${spaceId}/members/${userId}`, { role }),
  removeSpaceMember: (spaceId: string, userId: string) => request<{ ok: boolean }>('DELETE', `/spaces/${spaceId}/members/${userId}`),

  attachments: (spaceId: string) => request<{ attachments: Attachment[] }>('GET', `/attachments?spaceId=${spaceId}`),
  deleteAttachment: (key: string) => request<{ ok: boolean }>('DELETE', `/attachments/${key}`),
  async upload(spaceId: string, file: File): Promise<Attachment> {
    const payload = await send(`/attachments?spaceId=${spaceId}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: headersFor('POST', 'application/octet-stream'),
      body: await file.arrayBuffer(),
    });
    return (payload as { attachment: Attachment }).attachment;
  },
};
