import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import type { Database } from '../db/client.js';
import { pageContents, pages, pageVersions } from '../db/schema.js';
import { documentText, parseDocument, type HeroDocument, type PageDocument } from '../lib/document.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isValidPosition, POSITION_START, positionBetween } from '../lib/position.js';

const makeSlugId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

export type PageKind = 'page' | 'hero' | 'endpoint' | 'feature';

export interface TreeNode {
  id: string;
  slugId: string;
  title: string;
  kind: PageKind;
  icon: string | null;
  position: string;
  parentPageId: string | null;
  hasDraft: boolean;
  publishedAt: Date | null;
  children: TreeNode[];
}

export async function siblingPositions(
  db: Database,
  spaceId: string,
  parentPageId: string | null,
): Promise<string[]> {
  const rows = await db
    .select({ position: pages.position })
    .from(pages)
    .where(
      and(
        eq(pages.spaceId, spaceId),
        parentPageId ? eq(pages.parentPageId, parentPageId) : isNull(pages.parentPageId),
        isNull(pages.deletedAt),
      ),
    )
    .orderBy(asc(sql`${pages.position} COLLATE "C"`));
  return rows.map((row) => row.position);
}

export async function nextPosition(db: Database, spaceId: string, parentPageId: string | null): Promise<string> {
  const positions = await siblingPositions(db, spaceId, parentPageId);
  const last = positions[positions.length - 1] ?? null;
  return last ? positionBetween(last, null) : POSITION_START;
}

export function resolvePosition(positions: string[], index: number): string {
  const lower = index > 0 ? (positions[index - 1] ?? null) : null;
  const upper = positions[index] ?? null;
  return positionBetween(lower, upper);
}

export interface CreatePageInput {
  workspaceId: string;
  spaceId: string;
  parentPageId?: string | null;
  kind?: PageKind;
  icon?: string | null;
  title: string;
  locale: string;
  document?: unknown;
  creatorId: string;
}

export async function createPage(db: Database, input: CreatePageInput) {
  const kind = input.kind ?? 'page';
  const parentPageId = input.parentPageId ?? null;

  if (parentPageId) {
    const parent = await db.select({ id: pages.id }).from(pages).where(eq(pages.id, parentPageId)).limit(1);
    if (!parent.length) throw badRequest('La página padre no existe.');
  }

  const document = input.document ?? (kind === 'hero' ? { version: 1, hero: { title: input.title } } : { version: 1, sections: [] });
  const parsed = parseDocument(document, kind === 'hero' ? 'hero' : 'page');
  const position = await nextPosition(db, input.spaceId, parentPageId);

  const [page] = await db
    .insert(pages)
    .values({
      workspaceId: input.workspaceId,
      spaceId: input.spaceId,
      slugId: makeSlugId(),
      parentPageId,
      position,
      kind,
      icon: input.icon ?? null,
      creatorId: input.creatorId,
      lastUpdatedById: input.creatorId,
    })
    .returning();

  await db.insert(pageContents).values({
    pageId: page!.id,
    locale: input.locale,
    title: input.title,
    content: parsed,
    textContent: documentText(parsed),
    translationStatus: 'source',
  });

  return page!;
}

export async function saveContent(
  db: Database,
  pageId: string,
  locale: string,
  title: string,
  document: unknown,
  userId: string,
) {
  const page = await getPage(db, pageId);
  const parsed = parseDocument(document, page.kind === 'hero' ? 'hero' : 'page');
  const text = documentText(parsed);

  const existing = await db
    .select()
    .from(pageContents)
    .where(and(eq(pageContents.pageId, pageId), eq(pageContents.locale, locale)))
    .limit(1);

  if (existing.length) {
    await db
      .update(pageContents)
      .set({ title, content: parsed, textContent: text, updatedAt: new Date() })
      .where(eq(pageContents.id, existing[0]!.id));
  } else {
    await db.insert(pageContents).values({
      pageId,
      locale,
      title,
      content: parsed,
      textContent: text,
      translationStatus: 'current',
    });
  }

  await db.update(pages).set({ lastUpdatedById: userId, updatedAt: new Date() }).where(eq(pages.id, pageId));
  return { title, content: parsed };
}

export async function snapshotVersion(db: Database, pageId: string, locale: string, userId: string) {
  const content = await getContent(db, pageId, locale);
  const latest = await db
    .select({ version: pageVersions.version, content: pageVersions.content })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.locale, locale)))
    .orderBy(desc(pageVersions.version))
    .limit(1);

  const last = latest[0];
  if (last && JSON.stringify(last.content) === JSON.stringify(content.content)) return null;

  const [version] = await db
    .insert(pageVersions)
    .values({
      pageId,
      locale,
      version: (last?.version ?? 0) + 1,
      title: content.title,
      content: content.content,
      textContent: content.textContent,
      createdById: userId,
    })
    .returning();
  return version!;
}

export async function publishVersion(db: Database, pageId: string, locale: string, userId: string) {
  const snapshot = await snapshotVersion(db, pageId, locale, userId);
  const target =
    snapshot ??
    (
      await db
        .select()
        .from(pageVersions)
        .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.locale, locale)))
        .orderBy(desc(pageVersions.version))
        .limit(1)
    )[0];
  if (!target) throw badRequest('No hay contenido que publicar.');

  await db
    .update(pageVersions)
    .set({ published: false })
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.locale, locale), eq(pageVersions.published, true)));
  await db.update(pageVersions).set({ published: true }).where(eq(pageVersions.id, target.id));
  await db.update(pages).set({ publishedAt: new Date() }).where(eq(pages.id, pageId));
  return target;
}

export async function publishedContent(db: Database, pageId: string, locale: string) {
  const rows = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.locale, locale), eq(pageVersions.published, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPage(db: Database, pageId: string) {
  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), isNull(pages.deletedAt)))
    .limit(1);
  const page = rows[0];
  if (!page) throw notFound();
  return { ...page, kind: page.kind as PageKind };
}

export async function getContent(db: Database, pageId: string, locale: string) {
  const rows = await db
    .select()
    .from(pageContents)
    .where(and(eq(pageContents.pageId, pageId), eq(pageContents.locale, locale)))
    .limit(1);
  const content = rows[0];
  if (!content) throw notFound();
  return content;
}

export async function contentOrFallback(db: Database, pageId: string, locale: string, fallback: string) {
  const rows = await db.select().from(pageContents).where(eq(pageContents.pageId, pageId));
  return rows.find((row) => row.locale === locale) ?? rows.find((row) => row.locale === fallback) ?? null;
}

export async function movePage(
  db: Database,
  pageId: string,
  target: { parentPageId: string | null; position: string },
) {
  const page = await getPage(db, pageId);
  if (!isValidPosition(target.position)) throw badRequest('Posición inválida.');
  if (target.parentPageId) {
    if (target.parentPageId === pageId) throw badRequest('Una página no puede ser su propia madre.');
    const descendants = await descendantIds(db, pageId);
    if (descendants.includes(target.parentPageId)) throw badRequest('No puedes mover una página dentro de sí misma.');
  }
  await db
    .update(pages)
    .set({ parentPageId: target.parentPageId, position: target.position, updatedAt: new Date() })
    .where(eq(pages.id, page.id));
  return getPage(db, pageId);
}

export async function descendantIds(db: Database, pageId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM pages WHERE parent_page_id = ${pageId} AND deleted_at IS NULL
      UNION ALL
      SELECT p.id FROM pages p JOIN tree t ON p.parent_page_id = t.id WHERE p.deleted_at IS NULL
    ) SELECT id FROM tree`);
  return (rows as unknown as { id: string }[]).map((row) => row.id);
}

export async function softDeletePage(db: Database, pageId: string) {
  const ids = [pageId, ...(await descendantIds(db, pageId))];
  const now = new Date();
  for (const id of ids) {
    await db.update(pages).set({ deletedAt: now }).where(eq(pages.id, id));
  }
  return ids.length;
}

export async function spaceTree(db: Database, spaceId: string, locale: string, fallback: string): Promise<TreeNode[]> {
  const rows = await db
    .select({
      id: pages.id,
      slugId: pages.slugId,
      kind: pages.kind,
      icon: pages.icon,
      position: pages.position,
      parentPageId: pages.parentPageId,
      publishedAt: pages.publishedAt,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(eq(pages.spaceId, spaceId), isNull(pages.deletedAt)))
    .orderBy(asc(sql`${pages.position} COLLATE "C"`));

  const contents = await db
    .select({ pageId: pageContents.pageId, locale: pageContents.locale, title: pageContents.title })
    .from(pageContents);
  const titleFor = (pageId: string) => {
    const forPage = contents.filter((row) => row.pageId === pageId);
    return (forPage.find((row) => row.locale === locale) ?? forPage.find((row) => row.locale === fallback))?.title ?? '';
  };

  const published = await db
    .select({ pageId: pageVersions.pageId, content: pageVersions.content })
    .from(pageVersions)
    .where(eq(pageVersions.published, true));

  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slugId: row.slugId,
      title: titleFor(row.id),
      kind: row.kind as PageKind,
      icon: row.icon,
      position: row.position,
      parentPageId: row.parentPageId,
      hasDraft: !published.some((entry) => entry.pageId === row.id) || !row.publishedAt || row.updatedAt > row.publishedAt,
      publishedAt: row.publishedAt,
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentPageId && nodes.has(node.parentPageId)) nodes.get(node.parentPageId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export type { PageDocument, HeroDocument };
