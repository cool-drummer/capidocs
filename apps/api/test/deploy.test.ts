import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deploy, deployEnvironment, deployTargetSchema, isRemoteRepository, redactSecrets, stageBuild, type DeploySettings } from '../src/lib/deploy.js';
import type { PortalBuild } from '../src/modules/publish.js';
import { ROOT } from './helpers.js';

const run = promisify(execFile);
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
let publishRoot: string;
let settings: DeploySettings;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'capidocs-deploy-test-'));
  publishRoot = join(scratch, 'published');
  mkdirSync(publishRoot);
  settings = {
    publishRoot,
    wranglerBin: null,
    cloudflare: null,
    git: { authorName: 'Studio', authorEmail: 'studio@example.com', sshCommand: null },
    allowLocalRepositories: true,
  };
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function seedRepository(name: string, files: Record<string, string>): Promise<string> {
  const remote = join(scratch, `${name}.git`);
  const seed = join(scratch, `${name}-seed`);
  mkdirSync(seed, { recursive: true });
  await run('git', ['init', '--bare', '--initial-branch=main', remote]);
  await run('git', ['init', '--initial-branch=main', seed]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(seed, path, '..'), { recursive: true });
    writeFileSync(join(seed, path), content);
  }
  await run('git', ['-C', seed, 'add', '.']);
  await run('git', ['-C', seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed']);
  await run('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
  await run('git', ['-C', seed, 'push', 'origin', 'main']);
  return remote;
}

describe('deploy target validation', () => {
  it('accepts each supported target', () => {
    expect(deployTargetSchema.safeParse({ kind: 'none' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'directory', path: 'docs/acme' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'pages', project: 'docs' }).success).toBe(true);
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@github.com:org/web.git', subdirectory: 'docs' }).success).toBe(true);
  });

  it('rejects paths that leave their root', () => {
    for (const path of ['/etc', '../outside', 'docs/../../x', '.', '', 'docs/./x']) {
      expect(deployTargetSchema.safeParse({ kind: 'directory', path }).success).toBe(false);
    }
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@h:o/r.git', subdirectory: '.git' }).success).toBe(false);
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@h:o/r.git', subdirectory: 'docs/.git/hooks' }).success).toBe(false);
  });

  it('rejects option injection in refs and projects', () => {
    expect(deployTargetSchema.safeParse({ kind: 'pages', project: '--help' }).success).toBe(false);
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@h:o/r.git', subdirectory: 'docs', branch: '--upload-pack=x' }).success).toBe(false);
    expect(deployTargetSchema.safeParse({ kind: 'git', repository: 'git@h:o/r.git', subdirectory: 'docs', message: 'a\nb' }).success).toBe(false);
  });

  it('only accepts remote repositories without embedded credentials', () => {
    expect(isRemoteRepository('https://github.com/org/web.git')).toBe(true);
    expect(isRemoteRepository('git@github.com:org/web.git')).toBe(true);
    expect(isRemoteRepository('ssh://git@github.com/org/web.git')).toBe(true);
    for (const repository of [
      '--upload-pack=touch /tmp/pwned',
      'https://user:token@github.com/org/web.git',
      'file:///etc',
      '/srv/repos/web.git',
      'ext::sh -c touch% /tmp/pwned',
      'http://github.com/org/web.git',
    ]) {
      expect(isRemoteRepository(repository)).toBe(false);
    }
  });

  it('treats an empty target as nothing to deploy', async () => {
    const result = await deploy({}, builds, RUNTIME, settings);
    expect(result.detail).toContain('Configura un destino');
  });

  it('explains a malformed target without leaking internals', async () => {
    await expect(deploy({ kind: 'directory' }, builds, RUNTIME, settings)).rejects.toMatchObject({
      message: 'El destino de publicación no está bien configurado.',
    });
  });
});

describe('child processes', () => {
  it('receive only what they need, never the application secrets', () => {
    const env = deployEnvironment({ ...settings, git: { ...settings.git, sshCommand: 'ssh -i /run/key' } }, '/tmp/home');
    expect(Object.keys(env).sort()).toEqual(['GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'PATH']);
  });

  it('redact credentials from failure reasons', () => {
    expect(redactSecrets('fatal: unable to access https://user:token@github.com/org/web.git')).toBe(
      'fatal: unable to access https://***@github.com/org/web.git',
    );
  });
});

describe('directory target', () => {
  it('writes the runtime and the compiled files inside the publish root', async () => {
    const result = await deploy({ kind: 'directory', path: 'acme' }, builds, RUNTIME, settings);
    const out = join(publishRoot, 'acme');
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'js', 'main.js'))).toBe(true);
    expect(readFileSync(join(out, 'config', 'api-spec.json'), 'utf8')).toContain('site_config');
    expect(result.detail).not.toContain(publishRoot);
  });

  it('replaces the previous contents instead of merging them', async () => {
    const out = join(publishRoot, 'acme');
    writeFileSync(join(out, 'stale.txt'), 'viejo');
    await deploy({ kind: 'directory', path: 'acme' }, builds, RUNTIME, settings);
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);
  });

  it('is unavailable when the server has no publish root', async () => {
    await expect(deploy({ kind: 'directory', path: 'acme' }, builds, RUNTIME, { ...settings, publishRoot: null })).rejects.toMatchObject({
      code: 'deploy_unavailable',
    });
  });
});

describe('git target', () => {
  it('commits only inside its subdirectory and leaves the rest alone', async () => {
    const remote = await seedRepository('web', { 'index.php': '<?php echo "landing";', 'docs/old.html': 'viejo' });
    const result = await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME, settings);
    expect(result.detail).toContain('docs');

    const check = join(scratch, 'check');
    await run('git', ['clone', remote, check]);
    expect(readFileSync(join(check, 'index.php'), 'utf8')).toBe('<?php echo "landing";');
    expect(existsSync(join(check, 'docs', 'index.html'))).toBe(true);
    expect(existsSync(join(check, 'docs', 'old.html'))).toBe(false);
    const author = await run('git', ['-C', check, 'log', '-1', '--format=%an <%ae>']);
    expect(author.stdout.trim()).toBe('Studio <studio@example.com>');
  });

  it('reports no change when the content is identical', async () => {
    const remote = await seedRepository('web2', { 'readme.txt': 'x' });
    await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME, settings);
    const second = await deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME, settings);
    expect(second.detail).toBe('El repositorio ya tenía este contenido.');
  });

  it('refuses local repositories outside tests', async () => {
    const remote = await seedRepository('web3', { 'readme.txt': 'x' });
    await expect(
      deploy({ kind: 'git', repository: remote, subdirectory: 'docs' }, builds, RUNTIME, { ...settings, allowLocalRepositories: false }),
    ).rejects.toMatchObject({ message: 'El destino de publicación no está bien configurado.' });
  });

  it('turns a failed push into a friendly error and reports the reason to the server', async () => {
    const reasons: string[] = [];
    await expect(
      deploy({ kind: 'git', repository: join(scratch, 'missing.git'), subdirectory: 'docs' }, builds, RUNTIME, settings, (reason) => reasons.push(reason)),
    ).rejects.toMatchObject({ code: 'deploy_failed', statusCode: 502 });
    expect(reasons[0]).toBeTruthy();
  });
});

describe('pages target', () => {
  it('is unavailable without wrangler and Cloudflare credentials', async () => {
    await expect(deploy({ kind: 'pages', project: 'docs' }, builds, RUNTIME, settings)).rejects.toMatchObject({
      code: 'deploy_unavailable',
      message: 'La publicación en Cloudflare Pages no está disponible en este servidor.',
    });
  });
});

describe('staging', () => {
  it('copies the runtime next to the compiled files', () => {
    const out = join(scratch, 'staged');
    expect(stageBuild(out, builds, RUNTIME)).toBeGreaterThan(0);
    expect(existsSync(join(out, 'assets', 'css', 'capidocs.css'))).toBe(true);
    expect(existsSync(join(out, 'logos'))).toBe(true);
    expect(existsSync(join(out, 'diagrams.html'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'vendor', 'prism', 'prism-core.min.js'))).toBe(true);
    const headers = readFileSync(join(out, '_headers'), 'utf8');
    expect(headers).toContain("script-src 'self'");
    expect(headers).not.toContain('unsafe-inline');
  });

  it('refuses a compiled file that points outside the output', () => {
    const escaping = [{ ...builds[0]!, files: [{ path: '../escape.txt', content: 'x' }] }];
    expect(() => stageBuild(join(scratch, 'escape-test'), escaping, RUNTIME)).toThrow();
    expect(existsSync(join(scratch, 'escape.txt'))).toBe(false);
  });
});
