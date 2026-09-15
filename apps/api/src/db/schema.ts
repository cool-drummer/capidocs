import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_uuid_v7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  defaultLocale: varchar('default_locale', { length: 10 }).notNull().default('es'),
  locales: text('locales').array().notNull().default(sql`ARRAY['es']::text[]`),
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  locale: varchar('locale', { length: 10 }).notNull().default('es'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const members = pgTable(
  'members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('member'),
    invitedById: uuid('invited_by_id'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('members_workspace_user_idx').on(table.workspaceId, table.userId)],
);

export const groups = pgTable(
  'groups',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('groups_workspace_name_idx').on(table.workspaceId, sql`lower(${table.name})`)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const portals = pgTable(
  'portals',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    brand: jsonb('brand').notNull().default({}),
    locales: text('locales').array().notNull().default(sql`ARRAY['es']::text[]`),
    accessMode: varchar('access_mode', { length: 20 }).notNull().default('open'),
    deployTarget: jsonb('deploy_target').notNull().default({}),
    siteUrl: text('site_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('portals_workspace_slug_idx').on(table.workspaceId, table.slug)],
);

export const spaces = pgTable(
  'spaces',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'set null' }),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    icon: varchar('icon', { length: 100 }),
    audience: varchar('audience', { length: 20 }).notNull().default('internal'),
    defaultRole: varchar('default_role', { length: 20 }).notNull().default('reader'),
    settings: jsonb('settings').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('spaces_workspace_slug_idx').on(table.workspaceId, table.slug)],
);

export const spaceMembers = pgTable(
  'space_members',
  {
    id: id(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('reader'),
    addedById: uuid('added_by_id'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('space_members_space_user_idx').on(table.spaceId, table.userId),
    uniqueIndex('space_members_space_group_idx').on(table.spaceId, table.groupId),
  ],
);

export const pages = pgTable(
  'pages',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    slugId: varchar('slug_id', { length: 20 }).notNull().unique(),
    parentPageId: uuid('parent_page_id'),
    position: varchar('position', { length: 100 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull().default('page'),
    icon: varchar('icon', { length: 100 }),
    isLocked: boolean('is_locked').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    creatorId: uuid('creator_id').notNull(),
    lastUpdatedById: uuid('last_updated_by_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('pages_space_parent_position_idx').on(table.spaceId, table.parentPageId, table.position),
    index('pages_space_idx').on(table.spaceId),
  ],
);

export const pageContents = pgTable(
  'page_contents',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    content: jsonb('content').notNull(),
    textContent: text('text_content').notNull().default(''),
    translationStatus: varchar('translation_status', { length: 20 }).notNull().default('source'),
    ydoc: text('ydoc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('page_contents_page_locale_idx').on(table.pageId, table.locale)],
);

export const pageVersions = pgTable(
  'page_versions',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    locale: varchar('locale', { length: 10 }).notNull(),
    version: integer('version').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    content: jsonb('content').notNull(),
    textContent: text('text_content').notNull().default(''),
    published: boolean('published').notNull().default(false),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('page_versions_page_locale_version_idx').on(table.pageId, table.locale, table.version),
    index('page_versions_published_idx').on(table.pageId, table.locale, table.published),
  ],
);

export const publishJobs = pgTable(
  'publish_jobs',
  {
    id: id(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    requestedById: uuid('requested_by_id').notNull(),
    checksum: varchar('checksum', { length: 64 }),
    output: jsonb('output').notNull().default({}),
    log: text('log'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('publish_jobs_portal_idx').on(table.portalId, table.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull(),
    actorId: uuid('actor_id'),
    actorType: varchar('actor_type', { length: 20 }).notNull().default('user'),
    event: varchar('event', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }),
    resourceId: uuid('resource_id'),
    changes: jsonb('changes').notNull().default({}),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [index('audit_workspace_idx').on(table.workspaceId, table.createdAt)],
);
