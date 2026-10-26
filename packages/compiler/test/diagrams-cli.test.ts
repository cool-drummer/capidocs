import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const cli = join(root, 'packages', 'compiler', 'dist', 'cli.js');
const fixtures = join(root, 'apps', 'site', 'test', 'fixtures', 'diagrams');
const sample = join(fixtures, 'sample.json');

function run(args: string[], cwd = root): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('capidocs diagrams', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'capidocs-cli-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('validates files and exits with 1 on issues', async () => {
    const ok = run(['diagrams', 'validate', sample, join(fixtures, 'flow.mmd'), join(fixtures, 'library.drawio')]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('OK   ');
    expect(ok.stdout).toContain('(2 diagrams, drawio)');
    expect(ok.stdout).toContain('warning unsafe_link');
    const broken = join(dir, 'broken.json');
    await writeFile(broken, JSON.stringify({ title: 'X', diagrams: [{ id: 'd', title: 'D', nodes: [{ id: 'n', title: 'N', link: { href: 'javascript:alert(1)' } }] }] }));
    const failed = run(['diagrams', 'validate', broken]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('invalid_model');
    expect(failed.stderr).toContain('diagrams.0.nodes.0.link.href');
    expect(run(['diagrams', 'validate']).status).toBe(2);
  });

  it('imports and merges several formats into one set', async () => {
    const output = join(dir, 'set.json');
    const result = run(['diagrams', 'import', sample, join(fixtures, 'flow.mmd'), join(fixtures, 'library-compressed.drawio'), '-o', output, '--title', 'Todo junto', '--layout=auto']);
    expect(result.status).toBe(0);
    const set = JSON.parse(await readFile(output, 'utf8'));
    expect(set.title).toBe('Todo junto');
    expect(set.diagrams.map((diagram: { id: string }) => diagram.id)).toEqual(['overview', 'lineage', 'checkout', 'prestamo-de-libros', 'arch-1', 'seq-2']);
    expect(JSON.stringify(set.diagrams[4])).not.toContain('"x"');
    const again = run(['diagrams', 'validate', output]);
    expect(again.status).toBe(0);
  });

  it('bundles a self-contained HTML file', async () => {
    const output = join(dir, 'viewer.html');
    const result = run(['diagrams', 'bundle', sample, '-o', output, '--title=Visor', '--entry=test/fixtures/diagrams/standalone-entry.js']);
    expect(result.status).toBe(0);
    const html = await readFile(output, 'utf8');
    expect(html).toContain('<title>Visor</title>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('id="capidocs-diagram-set"');
    const missing = run(['diagrams', 'bundle', sample, '-o', join(dir, 'x.html'), '--entry=assets/js/diagram/does-not-exist.js']);
    expect(missing.status).toBe(1);
  });

  it('keeps reporting missing example files in the spec validator', async () => {
    const site = join(dir, 'site');
    await mkdir(join(site, 'config'), { recursive: true });
    const spec = JSON.parse(await readFile(join(root, 'apps', 'site', 'config', 'api-spec.json'), 'utf8'));
    await writeFile(join(site, 'config', 'api-spec.json'), JSON.stringify(spec));
    const ok = run(['validate', join(site, 'config', 'api-spec.json')]);
    expect(ok.status).toBe(1);
    expect(ok.stderr).toContain('missing example file');
  });
});
