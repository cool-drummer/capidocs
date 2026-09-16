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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
  me: () => request<{ user: SessionUser; workspace: Workspace }>('GET', '/me'),
  setup: (body: Record<string, unknown>) => request<{ workspace: Workspace }>('POST', '/auth/setup', body),
  login: (email: string, password: string) => request<{ user: SessionUser }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),

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
};
