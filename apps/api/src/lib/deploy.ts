import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { buildHeaders } from '@capidocs/compiler';
import { z } from 'zod';
import { ApiError, badRequest } from './errors.js';
import type { PortalBuild } from '../modules/publish.js';

const run = promisify(execFile);

const RELATIVE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const GIT_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/;
const REMOTE_REPOSITORY = /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._~/-]+|ssh:\/\/(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._~/-]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+)$/;

const relativePath = z.string().max(200).regex(RELATIVE_PATH);

export const deployTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('directory'), path: relativePath }).strict(),
  z
    .object({
      kind: z.literal('pages'),
      project: z.string().regex(/^[a-z0-9][a-z0-9-]{0,57}$/),
      branch: z.string().regex(GIT_REF).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('git'),
      repository: z.string().max(300),
      subdirectory: relativePath.refine((value) => !value.split('/').includes('.git')),
      branch: z.string().regex(GIT_REF).optional(),
      message: z.string().max(200).regex(/^[^\r\n]+$/).optional(),
    })
    .strict(),
]);

export type DeployTarget = z.infer<typeof deployTargetSchema>;

export interface DeployOutput {
  url?: string;
  detail: string;
}

export interface DeploySettings {
  publishRoot: string | null;
  wranglerBin: string | null;
  cloudflare: { apiToken: string; accountId: string } | null;
  git: { authorName: string; authorEmail: string; sshCommand: string | null };
  allowLocalRepositories?: boolean;
}

export const deployFailed = () =>
  new ApiError(502, 'deploy_failed', 'No se pudo publicar en el destino. Revisa la configuración del portal y vuelve a intentarlo.');
const targetUnavailable = (what: string) => new ApiError(400, 'deploy_unavailable', `La publicación ${what} no está disponible en este servidor.`);

const RUNTIME_ENTRIES = ['index.html', 'diagrams.html', 'assets', 'logos'];

export function isRemoteRepository(repository: string): boolean {
  return !repository.startsWith('-') && REMOTE_REPOSITORY.test(repository);
}

export function deployEnvironment(settings: DeploySettings, home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: 'C.UTF-8',
    GIT_TERMINAL_PROMPT: '0',
    ...(settings.git.sshCommand ? { GIT_SSH_COMMAND: settings.git.sshCommand } : {}),
    ...extra,
  };
}

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
      const destination = resolve(outDir, file.path);
      if (!destination.startsWith(resolve(outDir) + sep)) throw badRequest('Ruta de archivo inválida en la publicación.');
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
      bytes += Buffer.byteLength(file.content);
    }
  }
  const headers = buildHeaders(builds.map((build) => build.spec));
  writeFileSync(join(outDir, '_headers'), headers);
  return bytes + Buffer.byteLength(headers);
}

function confine(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(base, path);
  const inside = relative(base, target);
  if (!inside || inside.startsWith('..') || resolve(base, inside) !== target) throw badRequest('El destino de publicación no está bien configurado.');
  return target;
}

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'capidocs-deploy-'));
  try {
    return await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function deployDirectory(target: Extract<DeployTarget, { kind: 'directory' }>, builds: PortalBuild[], runtimeDir: string, settings: DeploySettings) {
  if (!settings.publishRoot) throw targetUnavailable('en una carpeta');
  const out = confine(settings.publishRoot, target.path);
  rmSync(out, { recursive: true, force: true });
  const bytes = stageBuild(out, builds, runtimeDir);
  return { detail: `${builds.length} idioma(s), ${(bytes / 1024).toFixed(0)} KB escritos en la carpeta ${target.path}` };
}

async function deployPages(target: Extract<DeployTarget, { kind: 'pages' }>, builds: PortalBuild[], runtimeDir: string, settings: DeploySettings) {
  if (!settings.wranglerBin || !settings.cloudflare) throw targetUnavailable('en Cloudflare Pages');
  const { wranglerBin, cloudflare } = settings;
  return withTempDir(async (dir) => {
    const site = join(dir, 'site');
    stageBuild(site, builds, runtimeDir);
    const env = deployEnvironment(settings, dir, { CLOUDFLARE_API_TOKEN: cloudflare.apiToken, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId });
    const { stdout } = await run(
      wranglerBin,
      ['pages', 'deploy', site, `--project-name=${target.project}`, `--branch=${target.branch ?? 'main'}`, '--commit-dirty=true'],
      { env, cwd: dir, timeout: 300_000, maxBuffer: 4_000_000 },
    );
    const url = /https:\/\/[a-z0-9.-]+\.pages\.dev/.exec(stdout)?.[0];
    return { ...(url ? { url } : {}), detail: `Publicado en Cloudflare Pages (${target.project})` };
  });
}

async function deployGit(target: Extract<DeployTarget, { kind: 'git' }>, builds: PortalBuild[], runtimeDir: string, settings: DeploySettings) {
  const local = settings.allowLocalRepositories && target.repository.startsWith('/');
  if (!local && !isRemoteRepository(target.repository)) throw badRequest('El destino de publicación no está bien configurado.');
  const branch = target.branch ?? 'main';

  return withTempDir(async (dir) => {
    const checkout = join(dir, 'checkout');
    const env = deployEnvironment(settings, dir);
    const safety = ['-c', 'protocol.ext.allow=never', '-c', `protocol.file.allow=${local ? 'always' : 'never'}`, '-c', 'core.hooksPath=/dev/null'];
    const git = (args: string[]) => run('git', [...safety, ...args], { cwd: checkout, env, timeout: 180_000, maxBuffer: 4_000_000 });

    await run('git', [...safety, 'clone', '--depth', '1', '--branch', branch, '--', target.repository, checkout], { cwd: dir, env, timeout: 180_000 });
    const subdirectory = confine(checkout, target.subdirectory);
    rmSync(subdirectory, { recursive: true, force: true });
    stageBuild(subdirectory, builds, runtimeDir);

    await git(['add', '--', target.subdirectory]);
    const status = await git(['status', '--porcelain', '--', target.subdirectory]);
    if (!status.stdout.trim()) return { detail: 'El repositorio ya tenía este contenido.' };

    await git([
      '-c',
      `user.name=${settings.git.authorName}`,
      '-c',
      `user.email=${settings.git.authorEmail}`,
      'commit',
      '-m',
      target.message ?? 'docs: publish portal',
    ]);
    await git(['push', 'origin', `HEAD:${branch}`]);
    const head = await git(['rev-parse', '--short', 'HEAD']);
    return { detail: `Publicado en ${target.subdirectory} (${head.stdout.trim()})` };
  });
}

export function redactSecrets(text: string): string {
  return text.replace(/(https?:\/\/)[^/\s@]+@/g, '$1***@').slice(0, 500);
}

export async function deploy(
  rawTarget: unknown,
  builds: PortalBuild[],
  runtimeDir: string,
  settings: DeploySettings,
  onFailure: (reason: string) => void = () => undefined,
): Promise<DeployOutput> {
  const empty = !rawTarget || (typeof rawTarget === 'object' && !Object.keys(rawTarget).length);
  const parsed = deployTargetSchema.safeParse(empty ? { kind: 'none' } : rawTarget);
  if (!parsed.success) throw badRequest('El destino de publicación no está bien configurado.');
  const target = parsed.data;

  if (target.kind === 'none') return { detail: 'Portal compilado. Configura un destino de despliegue para publicarlo.' };
  try {
    if (target.kind === 'directory') return await deployDirectory(target, builds, runtimeDir, settings);
    if (target.kind === 'pages') return await deployPages(target, builds, runtimeDir, settings);
    return await deployGit(target, builds, runtimeDir, settings);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const failure = error as { code?: unknown; stderr?: unknown; message?: string };
    onFailure(redactSecrets(`${String(failure.code ?? '')} ${String(failure.stderr ?? failure.message ?? '')}`.trim()));
    throw deployFailed();
  }
}
