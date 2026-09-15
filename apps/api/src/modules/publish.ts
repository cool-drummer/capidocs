import { and, eq, isNull } from 'drizzle-orm';
import { buildOutputs } from '@capidocs/compiler';
import type { Database } from '../db/client.js';
import { pages, portals, publishJobs, spaces, workspaces } from '../db/schema.js';
import { compilePortal, type CompilablePage, type CompileResult, type SpacePages } from '../lib/compile.js';
import { badRequest, notFound } from '../lib/errors.js';
import { publishedContent } from './pages.js';

export interface PortalBuild {
  locale: string;
  spec: CompileResult['spec'];
  checksum: string;
  files: { path: string; content: string }[];
}

export async function collectPortalPages(
  db: Database,
  portalId: string,
  locale: string,
  fallbackLocale: string,
): Promise<SpacePages[]> {
  const spaceRows = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.portalId, portalId), isNull(spaces.deletedAt)));

  const result: SpacePages[] = [];
  for (const space of spaceRows) {
    if (space.audience === 'internal') continue;
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

export async function buildPortal(db: Database, portalId: string): Promise<PortalBuild[]> {
  const portalRows = await db.select().from(portals).where(eq(portals.id, portalId)).limit(1);
  const portal = portalRows[0];
  if (!portal) throw notFound();

  const workspaceRows = await db.select().from(workspaces).where(eq(workspaces.id, portal.workspaceId)).limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) throw notFound();

  const builds: PortalBuild[] = [];
  for (const locale of portal.locales) {
    const spacePages = await collectPortalPages(db, portalId, locale, workspace.defaultLocale);
    if (!spacePages.length) throw badRequest('No hay páginas publicadas en este portal todavía.');

    const compiled = compilePortal({
      portal: {
        slug: portal.slug,
        name: portal.name,
        brand: portal.brand as never,
        accessMode: portal.accessMode as 'open' | 'gate' | 'accounts',
        accessConfig: (portal as unknown as { accessConfig?: Record<string, unknown> }).accessConfig ?? {},
        siteUrl: portal.siteUrl,
        locales: portal.locales,
      },
      locale,
      defaultLocale: workspace.defaultLocale,
      spaces: spacePages,
    });

    const outputs = buildOutputs(compiled.spec);
    const specName = locale === workspace.defaultLocale ? 'config/api-spec.json' : `config/api-spec.${locale}.json`;
    const files = [
      { path: specName, content: `${JSON.stringify(compiled.spec, null, 2)}\n` },
      ...(locale === workspace.defaultLocale
        ? [
            { path: 'search-index.json', content: JSON.stringify(outputs.searchIndex) },
            { path: 'llms.txt', content: outputs.llms },
            { path: 'llms-full.txt', content: outputs.llmsFull },
            { path: 'sitemap.xml', content: outputs.sitemap },
            { path: 'robots.txt', content: outputs.robots },
          ]
        : []),
    ];
    builds.push({ locale, spec: compiled.spec, checksum: compiled.checksum, files });
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
    .orderBy(publishJobs.createdAt)
    .limit(1);

  const [job] = await db
    .insert(publishJobs)
    .values({ portalId, requestedById: userId, status: 'running', checksum, startedAt: new Date() })
    .returning();

  if (previous.length && previous[previous.length - 1]?.checksum === checksum) {
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
