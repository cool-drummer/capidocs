import type { Sql } from 'postgres';

const STATEMENTS = [
  `CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid AS $$
     SELECT encode(
       set_bit(
         set_bit(
           overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6),
           52, 0),
         53, 1), 'hex')::uuid;
   $$ LANGUAGE sql VOLATILE`,

  `CREATE TABLE IF NOT EXISTS workspaces (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     name varchar(200) NOT NULL,
     slug varchar(100) NOT NULL UNIQUE,
     default_locale varchar(10) NOT NULL DEFAULT 'es',
     locales text[] NOT NULL DEFAULT ARRAY['es']::text[],
     settings jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     email varchar(320) NOT NULL UNIQUE,
     name varchar(200) NOT NULL,
     password_hash text,
     email_verified_at timestamptz,
     locale varchar(10) NOT NULL DEFAULT 'es',
     last_login_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash text NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     user_agent text,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,

  `CREATE TABLE IF NOT EXISTS members (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role varchar(20) NOT NULL DEFAULT 'member',
     invited_by_id uuid,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_workspace_user_idx ON members(workspace_id, user_id)`,

  `CREATE TABLE IF NOT EXISTS groups (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name varchar(200) NOT NULL,
     is_default boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS groups_workspace_name_idx ON groups(workspace_id, lower(name))`,

  `CREATE TABLE IF NOT EXISTS group_members (
     group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (group_id, user_id))`,

  `CREATE TABLE IF NOT EXISTS portals (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     slug varchar(100) NOT NULL,
     name varchar(200) NOT NULL,
     brand jsonb NOT NULL DEFAULT '{}'::jsonb,
     locales text[] NOT NULL DEFAULT ARRAY['es']::text[],
     access_mode varchar(20) NOT NULL DEFAULT 'open',
     access_config jsonb NOT NULL DEFAULT '{}'::jsonb,
     deploy_target jsonb NOT NULL DEFAULT '{}'::jsonb,
     site_url text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portals_workspace_slug_idx ON portals(workspace_id, slug)`,

  `CREATE TABLE IF NOT EXISTS spaces (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     portal_id uuid REFERENCES portals(id) ON DELETE SET NULL,
     slug varchar(100) NOT NULL,
     name varchar(200) NOT NULL,
     icon varchar(100),
     audience varchar(20) NOT NULL DEFAULT 'internal',
     default_role varchar(20) NOT NULL DEFAULT 'reader',
     settings jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz,
     CONSTRAINT spaces_audience_check CHECK (audience IN ('public','customers','internal')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS spaces_workspace_slug_idx ON spaces(workspace_id, slug)`,

  `CREATE TABLE IF NOT EXISTS space_members (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
     user_id uuid REFERENCES users(id) ON DELETE CASCADE,
     group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
     role varchar(20) NOT NULL DEFAULT 'reader',
     added_by_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT space_members_user_xor_group CHECK (num_nonnulls(user_id, group_id) = 1),
     CONSTRAINT space_members_role_check CHECK (role IN ('admin','writer','reader')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS space_members_space_user_idx ON space_members(space_id, user_id) WHERE user_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS space_members_space_group_idx ON space_members(space_id, group_id) WHERE group_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS pages (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
     slug_id varchar(20) NOT NULL UNIQUE,
     parent_page_id uuid REFERENCES pages(id) ON DELETE CASCADE,
     position varchar(100) NOT NULL,
     kind varchar(20) NOT NULL DEFAULT 'page',
     icon varchar(100),
     is_locked boolean NOT NULL DEFAULT false,
     published_at timestamptz,
     creator_id uuid NOT NULL,
     last_updated_by_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz,
     CONSTRAINT pages_kind_check CHECK (kind IN ('page','hero','endpoint','feature')))`,
  `CREATE INDEX IF NOT EXISTS pages_space_parent_position_idx ON pages(space_id, parent_page_id, position COLLATE "C") WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS pages_space_idx ON pages(space_id) WHERE deleted_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS page_contents (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     locale varchar(10) NOT NULL,
     title varchar(300) NOT NULL,
     content jsonb NOT NULL,
     text_content text NOT NULL DEFAULT '',
     translation_status varchar(20) NOT NULL DEFAULT 'source',
     ydoc text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS page_contents_page_locale_idx ON page_contents(page_id, locale)`,

  `CREATE TABLE IF NOT EXISTS page_versions (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
     locale varchar(10) NOT NULL,
     version integer NOT NULL,
     title varchar(300) NOT NULL,
     content jsonb NOT NULL,
     text_content text NOT NULL DEFAULT '',
     published boolean NOT NULL DEFAULT false,
     created_by_id uuid NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS page_versions_page_locale_version_idx ON page_versions(page_id, locale, version)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS page_versions_one_published_idx ON page_versions(page_id, locale) WHERE published`,

  `CREATE TABLE IF NOT EXISTS publish_jobs (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     portal_id uuid NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
     status varchar(20) NOT NULL DEFAULT 'queued',
     requested_by_id uuid NOT NULL,
     checksum varchar(64),
     output jsonb NOT NULL DEFAULT '{}'::jsonb,
     log text,
     started_at timestamptz,
     finished_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS publish_jobs_portal_idx ON publish_jobs(portal_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS audit_log (
     id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
     workspace_id uuid NOT NULL,
     actor_id uuid,
     actor_type varchar(20) NOT NULL DEFAULT 'user',
     event varchar(100) NOT NULL,
     resource_type varchar(50),
     resource_id uuid,
     changes jsonb NOT NULL DEFAULT '{}'::jsonb,
     ip varchar(64),
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS audit_workspace_idx ON audit_log(workspace_id, created_at DESC)`,
];

export async function migrate(sql: Sql): Promise<number> {
  await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  for (const statement of STATEMENTS) {
    await sql.unsafe(statement);
  }
  return STATEMENTS.length;
}
