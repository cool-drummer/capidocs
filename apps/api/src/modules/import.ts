import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { portals, spaceMembers, spaces, workspaces } from '../db/schema.js';
import { resolveCodeFiles } from '@capidocs/compiler';
import { importSpec, type ImportedPortal } from '../lib/import-spec.js';
import { createPage, publishVersion } from './pages.js';

export interface ImportResult {
  portalId: string;
  portalName: string;
  spaces: { id: string; name: string; pages: number }[];
  warnings: string[];
}

async function uniqueSlug(db: Database, workspaceId: string, base: string, kind: 'portal' | 'space'): Promise<string> {
  const rows =
    kind === 'portal'
      ? await db.select({ slug: portals.slug }).from(portals).where(eq(portals.workspaceId, workspaceId))
      : await db.select({ slug: spaces.slug }).from(spaces).where(eq(spaces.workspaceId, workspaceId));
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function importPortal(
  db: Database,
  workspaceId: string,
  userId: string,
  raw: unknown,
  options: { label?: string; publish?: boolean; portalName?: string; resolveFrom?: string } = {},
): Promise<ImportResult> {
  const source = options.resolveFrom ? (await resolveCodeFiles(raw, { baseDir: options.resolveFrom })).spec : raw;
  const imported: ImportedPortal = importSpec(source, { label: options.label ?? 'spec' });
  const workspaceRows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const workspace = workspaceRows[0]!;
  const locale = imported.locales[0] ?? workspace.defaultLocale;

  const [portal] = await db
    .insert(portals)
    .values({
      workspaceId,
      name: options.portalName ?? imported.name,
      slug: await uniqueSlug(db, workspaceId, imported.slug, 'portal'),
      siteUrl: imported.siteUrl,
      locales: imported.locales,
      accessMode: imported.accessMode,
      brand: imported.brand,
      ...(Object.keys(imported.accessConfig).length ? { accessConfig: imported.accessConfig } : {}),
    })
    .returning();

  const created: ImportResult['spaces'] = [];
  for (const space of imported.spaces) {
    const [row] = await db
      .insert(spaces)
      .values({
        workspaceId,
        portalId: portal!.id,
        name: space.name,
        slug: await uniqueSlug(db, workspaceId, space.slug, 'space'),
        audience: 'public',
      })
      .returning();
    await db.insert(spaceMembers).values({ spaceId: row!.id, userId, role: 'admin', addedById: userId });

    for (const page of space.pages) {
      const record = await createPage(db, {
        workspaceId,
        spaceId: row!.id,
        title: page.title,
        kind: page.kind,
        icon: page.icon,
        locale,
        document: page.document,
        creatorId: userId,
      });
      if (options.publish !== false) await publishVersion(db, record.id, locale, userId);
    }
    created.push({ id: row!.id, name: space.name, pages: space.pages.length });
  }

  return { portalId: portal!.id, portalName: portal!.name, spaces: created, warnings: imported.warnings };
}
