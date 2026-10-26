import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { badRequest } from './errors.js';
import type { PortalBuild } from '../modules/publish.js';

const run = promisify(execFile);

export const deployTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('directory'), path: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('pages'),
      project: z.string().min(1),
      branch: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('git'),
      repository: z.string().min(1),
      subdirectory: z.string().min(1),
      branch: z.string().min(1).optional(),
      message: z.string().min(1).optional(),
    })
    .strict(),
]);

export type DeployTarget = z.infer<typeof deployTargetSchema>;
export interface DeployOutput {
  url?: string;
  detail: string;
}

const RUNTIME_ENTRIES = ['index.html', 'assets', 'logos'];

export function stageBuild(outDir: string, builds: PortalBuild[], runtimeDir: string): number {
  mkdirSync(outDir, { recursive: true });
  for (const entry of RUNTIME_ENTRIES) {
    try {
      cpSync(join(runtimeDir, entry), join(outDir, entry), { recursive: true });
    } catch {
      continue;
    }
  }
  let bytes = 0;
  for (const build of builds) {
    for (const file of build.files) {
      const destination = join(outDir, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
      bytes += Buffer.byteLength(file.content);
    }
  }
  return bytes;
}

function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'capidocs-deploy-'));
  return work(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function deployDirectory(target: Extract<DeployTarget, { kind: 'directory' }>, builds: PortalBuild[], runtimeDir: string): Promise<DeployOutput> {
  const out = resolve(target.path);
  rmSync(out, { recursive: true, force: true });
  const bytes = stageBuild(out, builds, runtimeDir);
  return { url: out, detail: `${builds.length} idioma(s), ${(bytes / 1024).toFixed(0)} KB escritos en disco` };
}

async function deployPages(
  target: Extract<DeployTarget, { kind: 'pages' }>,
  builds: PortalBuild[],
  runtimeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<DeployOutput> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw badRequest('Falta configurar el acceso a Cloudflare para publicar en Pages.');
  }
  return withTempDir(async (dir) => {
    stageBuild(dir, builds, runtimeDir);
    const { stdout } = await run(
      'npx',
      ['--yes', 'wrangler', 'pages', 'deploy', dir, `--project-name=${target.project}`, `--branch=${target.branch ?? 'main'}`, '--commit-dirty=true'],
      { env, timeout: 300000, maxBuffer: 4_000_000 },
    );
    const url = /https:\/\/[^\s]+\.pages\.dev/.exec(stdout)?.[0];
    return { ...(url ? { url } : {}), detail: `Publicado en Cloudflare Pages (${target.project})` };
  });
}

async function deployGit(
  target: Extract<DeployTarget, { kind: 'git' }>,
  builds: PortalBuild[],
  runtimeDir: string,
  env: NodeJS.ProcessEnv,
): Promise<DeployOutput> {
  const branch = target.branch ?? 'main';
  return withTempDir(async (dir) => {
    const git = (args: string[]) => run('git', args, { cwd: dir, env, timeout: 180000, maxBuffer: 4_000_000 });
    await run('git', ['clone', '--depth', '1', '--branch', branch, target.repository, dir], { env, timeout: 180000 });

    const subdirectory = join(dir, target.subdirectory);
    rmSync(subdirectory, { recursive: true, force: true });
    stageBuild(subdirectory, builds, runtimeDir);

    await git(['add', '--', target.subdirectory]);
    const status = await git(['status', '--porcelain', '--', target.subdirectory]);
    if (!status.stdout.trim()) return { detail: 'El repositorio ya tenía este contenido.' };

    await git(['-c', 'user.name=capidocs', '-c', 'user.email=capidocs@localhost', 'commit', '-m', target.message ?? 'docs: publish portal']);
    await git(['push', 'origin', branch]);
    const head = await git(['rev-parse', '--short', 'HEAD']);
    return { detail: `Publicado en ${target.subdirectory} (${head.stdout.trim()})` };
  });
}

export async function deploy(
  rawTarget: unknown,
  builds: PortalBuild[],
  runtimeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeployOutput> {
  const parsed = deployTargetSchema.safeParse(rawTarget && Object.keys(rawTarget).length ? rawTarget : { kind: 'none' });
  if (!parsed.success) throw badRequest('El destino de publicación no está bien configurado.');
  const target = parsed.data;

  if (target.kind === 'none') {
    return { detail: 'Portal compilado. Configura un destino de despliegue para publicarlo.' };
  }
  if (target.kind === 'directory') return deployDirectory(target, builds, runtimeDir);
  if (target.kind === 'pages') return deployPages(target, builds, runtimeDir, env);
  return deployGit(target, builds, runtimeDir, env);
}
