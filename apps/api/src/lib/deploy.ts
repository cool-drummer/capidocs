import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PortalBuild } from '../modules/publish.js';

export interface DeployTarget {
  kind: 'directory';
  path: string;
  runtimeDir?: string;
}

const RUNTIME_ENTRIES = ['index.html', 'assets', 'logos'];

export function writeBuild(target: DeployTarget, builds: PortalBuild[], runtimeDir: string) {
  const out = resolve(target.path);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const entry of RUNTIME_ENTRIES) {
    const source = join(runtimeDir, entry);
    try {
      cpSync(source, join(out, entry), { recursive: true });
    } catch {
      continue;
    }
  }

  let bytes = 0;
  for (const build of builds) {
    for (const file of build.files) {
      const destination = join(out, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
      bytes += Buffer.byteLength(file.content);
    }
  }

  return { url: out, detail: `${builds.length} locale(s), ${(bytes / 1024).toFixed(0)} KB de contenido` };
}
