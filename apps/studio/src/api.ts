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

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const BASE = '/api';
let csrfToken = '';

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: headersFor(method, body ? 'application/json' : undefined),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const message = typeof payload.message === 'string' ? payload.message : 'Algo salió mal, inténtalo de nuevo en un momento.';
    throw new ApiError(response.status, message);
  }
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
    const response = await fetch(`${BASE}/attachments?spaceId=${spaceId}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: headersFor('POST', 'application/octet-stream'),
      body: await file.arrayBuffer(),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiError(response.status, typeof payload.message === 'string' ? payload.message : 'No se pudo subir el archivo.');
    }
    return (payload as { attachment: Attachment }).attachment;
  },
};
