import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploy, deployTargetSchema, stageBuild } from '../src/lib/deploy.js';
import type { PortalBuild } from '../src/modules/publish.js';

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..', '..', '..');
const RUNTIME = join(ROOT, 'apps/site');

const builds: PortalBuild[] = [
  {
    locale: 'es',
    spec: { site_config: { name: 'X' }, pages: { home: { template: 'hero', content: { hero: { title: 'X' } } } } } as never,
    checksum: 'abc',
    files: [
      { path: 'config/api-spec.json', content: '{"site_config":{"name":"X"}}' },
      { path: 'robots.txt', content: 'User-agent: *\n' },
    ],
  },
];

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'capidocs-deploy-test-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('deploy target validation', () => {
  it('accepts each supported target', () => {
    expect(deployTargetSchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'directory', path: '/tmp/x' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'pages', project: 'docs' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@host:repo.git', subdirectory: 'docs' }).success).toBe(true);
  });

  it('rejects a target with unknown or missing fields', () => {
    expect(deployTargetSchema.safeParse({ kind: 'directory' }).success).toBe(false);
    expect(deployTargetSchema.safeParse({ kind: 'directory', path: '/tmp/x', extra: 1 }).success).toBe(false);
    expect(deployTargetSchema.safeParse({ kind: 'ftp', host: 'x' }).success).toBe(false);
  });

  it('treats an empty target as nothing to deploy', async () => {
    const result = await deploy({}, builds, RUNTIME);
    expect(result.detail).toContain('Configura un destino');
    expect(result.url).toBeUndefined();
  });

  it('explains a malformed target without leaking internals', async () => {
    await expect(deploy({ kind: 'directory' }, builds, RUNTIME)).rejects.toMatchObject({
      message: 'El destino de publicación no está bien configurado.',
    });
  });
});

describe('directory target', () => {
  it('writes the runtime and the compiled files', async () => {
    const out = join(scratch, 'site');
    const result = await deploy({ kind: 'directory', path: out }, builds, RUNTIME);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'js', 'main.js'))).toBe(true);
    expect(readFileSync(join(out, 'config', 'api-spec.json'), 'utf8')).toContain('site_config');
    expect(result.url).toBe(out);
  });

  it('replaces the previous contents instead of merging them', async () => {
    const out = join(scratch, 'site');
    writeFileSync(join(out, 'stale.txt'), 'viejo');
    await deploy({ kind: 'directory', path: out }, builds, RUNTIME);
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });
});

describe('git target', () => {
  it('commits only inside its subdirectory and leaves the rest alone', async () => {
    const remote = join(scratch, 'remote.git');
    const seed = join(scratch, 'seed');
    mkdirSync(seed, { recursive: true });
    await run('git', ['init', '--bare', '--initial-branch=main', remote]);
    await run('git', ['init', '--initial-branch=main', seed]);
    writeFileSync(join(seed, 'index.php'), '<?php echo "landing";');
    mkdirSync(join(seed, 'docs'), { recursive: true });
    writeFileSync(join(seed, 'docs', 'old.html'), 'viejo');
    await run('git', ['-C', seed, 'add', '.']);
    await run('git', ['-C', seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);
    await run('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
    await run('git', ['-C', seed, 'push', 'origin', 'main']);

    const result = await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME);
    expect(result.detail).toContain('docs');

    const check = join(scratch, 'check');
    await run('git', ['clone', remote, check]);
    expect(existsSync(join(check, 'index.php'))).toBe(true);
    expect(existsSync(join(check, 'docs', 'index.html'))).toBe(true);
    expect(existsSync(join(check, 'docs', 'old.html'))).toBe(false);
    expect(readFileSync(join(check, 'index.php'), 'utf8')).toBe('<?php echo "landing";');
  });

  it('reports no change when the content is identical', async () => {
    const remote = join(scratch, 'remote2.git');
    await run('git', ['init', '--bare', '--initial-branch=main', remote]);
    const seed = join(scratch, 'seed2');
    mkdirSync(seed, { recursive: true });
    await run('git', ['init', '--initial-branch=main', seed]);
    writeFileSync(join(seed, 'readme.md'), 'x');
    await run('git', ['-C', seed, 'add', '.']);
    await run('git', ['-C', seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);
    await run('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
    await run('git', ['-C', seed, 'push', 'origin', 'main']);

    await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME);
    const second = await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME);
    expect(second.detail).toBe('El repositorio ya tenía este contenido.');
  });
});

describe('pages target', () => {
  it('refuses to run without Cloudflare credentials', async () => {
    await expect(deploy({ kind: 'pages', project: 'docs' }, builds, RUNTIME, {})).rejects.toMatchObject({
      message: 'Falta configurar el acceso a Cloudflare para publicar en Pages.',
    });
  });
});

describe('staging', () => {
  it('copies the runtime next to the compiled files', () => {
    const out = join(scratch, 'staged');
    const bytes = stageBuild(out, builds, RUNTIME);
    expect(bytes).toBeGreaterThan(0);
    expect(existsSync(join(out, 'assets', 'css', 'capidocs.css'))).toBe(true);
    expect(existsSync(join(out, 'logos'))).toBe(true);
  });
});
