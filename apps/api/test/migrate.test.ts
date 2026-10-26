import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { resetDatabase, testDatabaseUrl } from './helpers.js';

const DATABASE_URL = testDatabaseUrl('capidocs_migrate_test');
let sql: postgres.Sql;

beforeAll(async () => {
  await resetDatabase(DATABASE_URL);
  sql = postgres(DATABASE_URL, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await sql?.end();
});

describe('migrations', () => {
  it('run concurrently from several processes without failing', async () => {
    const counts = await Promise.all([migrate(sql), migrate(sql), migrate(sql)]);
    expect(new Set(counts).size).toBe(1);
  });

  it('are idempotent', async () => {
    await expect(migrate(sql)).resolves.toBeGreaterThan(0);
  });

  it('need no extension beyond the core of postgres', async () => {
    const rows = await sql`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'`;
    expect(rows).toEqual([]);
    const [row] = await sql`SELECT gen_uuid_v7() AS id`;
    expect(String(row!.id)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
