import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { buildOutputs } from '@capidocs/compiler';
import type { Database } from '../db/client.js';
import { attachments, pages, portals, publishJobs, spaces, workspaces } from '../db/schema.js';
import { compilePortal, type CompilablePage, type CompileResult, type SpacePages } from '../lib/compile.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { AttachmentStore } from '../lib/storage.js';
import { publishedContent } from './pages.js';

export interface PortalBuild {
  locale: string;
  spec: CompileResult['spec'];
  checksum: string;
  files: { path: string; content: string | Buffer }[];
}

export type FileReferences = { mode: 'bundle'; store: AttachmentStore } | { mode: 'sign'; sign: (key: string) => string };

export interface BuildOptions {
  files: FileReferences;
  spaceIds?: string[] | 'all';
}

const FILE_REFERENCE = /\/api\/files\/([0-9a-f]{32}\.(?:png|jpg|gif|webp|pdf))/g;
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
export const UPLOADS_DIR = 'assets/uploads';

export const foreignFile = () =>
  badRequest('Una página usa un archivo que no pertenece a este portal. Súbelo de nuevo desde el editor de la página.');

function collectFileKeys(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(FILE_REFERENCE)) keys.add(match[1]!);
  } else if (Array.isArray(value)) {
    for (const item of value) collectFileKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectFileKeys(item, keys);
  }
}

function rewriteFileReferences<T>(value: T, rewrite: (key: string) => string): T {
  if (typeof value === 'string') return value.replace(FILE_REFERENCE, (_match, key: string) => rewrite(key)) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteFileReferences(item, rewrite)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteFileReferences(item, rewrite)])) as T;
  }
  return value;
}

export async function portalSpaceIds(db: Database, portalId: string, visible: string[] | 'all' = 'all'): Promise<string[]> {
  const rows = await db
    .select({ id: spaces.id, audience: spaces.audience })
    .from(spaces)
    .where(and(eq(spaces.portalId, portalId), isNull(spaces.deletedAt)));
  return rows.filter((row) => row.audience !== 'internal' && (visible === 'all' || visible.includes(row.id))).map((row) => row.id);
}

export async function collectPortalPages(
  db: Database,
  portalId: string,
  locale: string,
  fallbackLocale: string,
  visible: string[] | 'all' = 'all',
): Promise<SpacePages[]> {
  const allowed = await portalSpaceIds(db, portalId, visible);
  const spaceRows = allowed.length ? await db.select().from(spaces).where(inArray(spaces.id, allowed)) : [];

  const result: SpacePages[] = [];
  for (const space of spaceRows) {
    const pageRows = await db
      .select()
      .from(pages)
      .where(and(eq(pages.spaceId, space.id), isNull(pages.deletedAt)));

    const compilable: CompilablePage[] = [];
    for (const page of pageRows) {
      const version = (await publishedContent(db, page.id, locale)) ?? (await publishedContent(db, page.id, fallbackLocale));
      if (!version) continue;
      compilable.push({
        id: page.id,
        slugId: page.slugId,
        kind: page.kind as CompilablePage['kind'],
        icon: page.icon,
        parentPageId: page.parentPageId,
        position: page.position,
        title: version.title,
        document: version.content as CompilablePage['document'],
      });
    }
    if (compilable.length) {
      result.push({ spaceId: space.id, spaceName: space.name, spaceSlug: space.slug, pages: compilable });
    }
  }
  return result;
}

async function resolveFiles(db: Database, workspaceId: string, spaceIds: string[], spec: CompileResult['spec'], files: FileReferences) {
  const keys = new Set<string>();
  collectFileKeys(spec, keys);
  if (!keys.size) return { spec, uploads: [] as PortalBuild['files'] };

  const rows = spaceIds.length
    ? await db
        .select({ storageKey: attachments.storageKey })
        .from(attachments)
        .where(and(eq(attachments.workspaceId, workspaceId), inArray(attachments.storageKey, [...keys]), inArray(attachments.spaceId, spaceIds)))
    : [];
  const owned = new Set(rows.map((row) => row.storageKey));

  if (files.mode === 'sign') {
    return { spec: rewriteFileReferences(spec, (key) => (owned.has(key) ? files.sign(key) : PLACEHOLDER_IMAGE)), uploads: [] };
  }
  if ([...keys].some((key) => !owned.has(key))) throw foreignFile();
  const uploads: PortalBuild['files'] = [];
  for (const key of keys) uploads.push({ path: `${UPLOADS_DIR}/${key}`, content: await files.store.get(key) });
  return { spec: rewriteFileReferences(spec, (key) => `${UPLOADS_DIR}/${key}`), uploads };
}

export async function buildPortal(db: Database, portalId: string, options: BuildOptions): Promise<PortalBuild[]> {
  const portalRows = await db.select().from(portals).where(eq(portals.id, portalId)).limit(1);
  const portal = portalRows[0];
  if (!portal) throw notFound();

  const workspaceRows = await db.select().from(workspaces).where(eq(workspaces.id, portal.workspaceId)).limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) throw notFound();

  const builds: PortalBuild[] = [];
  for (const locale of portal.locales) {
    const spacePages = await collectPortalPages(db, portalId, locale, workspace.defaultLocale, options.spaceIds ?? 'all');
    if (!spacePages.length) throw badRequest('No hay páginas publicadas en este portal todavía.');

    const compiled = compilePortal({
      portal: {
        slug: portal.slug,
        name: portal.name,
        brand: portal.brand as never,
        accessMode: portal.accessMode as 'open' | 'gate' | 'accounts',
        accessConfig: (portal.accessConfig ?? {}) as Record<string, unknown>,
        siteUrl: portal.siteUrl,
        locales: portal.locales,
      },
      locale,
      defaultLocale: workspace.defaultLocale,
      spaces: spacePages,
    });

    const { spec, uploads } = await resolveFiles(
      db,
      portal.workspaceId,
      spacePages.map((space) => space.spaceId),
      compiled.spec,
      options.files,
    );
    const outputs = buildOutputs(spec);
    const specName = locale === workspace.defaultLocale ? 'config/api-spec.json' : `config/api-spec.${locale}.json`;
    const files = [
      { path: specName, content: `${JSON.stringify(spec, null, 2)}\n` },
      ...(locale === workspace.defaultLocale
        ? [
            { path: 'search-index.json', content: JSON.stringify(outputs.searchIndex) },
            { path: 'llms.txt', content: outputs.llms },
            { path: 'llms-full.txt', content: outputs.llmsFull },
            { path: 'sitemap.xml', content: outputs.sitemap },
            { path: 'robots.txt', content: outputs.robots },
          ]
        : []),
      ...uploads,
    ];
    builds.push({ locale, spec, checksum: compiled.checksum, files });
  }
  return builds;
}

export async function recordPublish(
  db: Database,
  portalId: string,
  userId: string,
  builds: PortalBuild[],
  writer: (builds: PortalBuild[]) => Promise<{ url?: string; detail?: string }>,
) {
  const checksum = builds.map((build) => build.checksum).join(':').slice(0, 64);
  const previous = await db
    .select({ checksum: publishJobs.checksum })
    .from(publishJobs)
    .where(and(eq(publishJobs.portalId, portalId), eq(publishJobs.status, 'done')))
    .orderBy(desc(publishJobs.createdAt))
    .limit(1);

  const [job] = await db
    .insert(publishJobs)
    .values({ portalId, requestedById: userId, status: 'running', checksum, startedAt: new Date() })
    .returning();

  if (previous[0]?.checksum === checksum) {
    await db
      .update(publishJobs)
      .set({ status: 'unchanged', finishedAt: new Date(), log: 'Sin cambios desde la última publicación.' })
      .where(eq(publishJobs.id, job!.id));
    return { job: job!, status: 'unchanged' as const, output: {} };
  }

  try {
    const output = await writer(builds);
    await db
      .update(publishJobs)
      .set({ status: 'done', finishedAt: new Date(), output })
      .where(eq(publishJobs.id, job!.id));
    return { job: job!, status: 'done' as const, output };
  } catch (error) {
    await db
      .update(publishJobs)
      .set({ status: 'failed', finishedAt: new Date(), log: (error as Error).message })
      .where(eq(publishJobs.id, job!.id));
    throw error;
  }
}
