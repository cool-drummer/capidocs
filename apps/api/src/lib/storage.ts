import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { notFound } from './errors.js';
import { amzDate, EMPTY_PAYLOAD_HASH, encodeKeyPath, sha256Hex, signS3Request } from './s3.js';

export interface AttachmentStore {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const STORAGE_KEY_PATTERN = /^[0-9a-f]{32}\.(png|jpg|gif|webp|pdf)$/;

function assertKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) throw notFound();
}

export function createLocalStore(root: string): AttachmentStore {
  const base = resolve(root);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const pathFor = (key: string) => {
    assertKey(key);
    return join(base, key);
  };
  return {
    async put(key, bytes) {
      await writeFile(pathFor(key), bytes, { mode: 0o600, flag: 'wx' });
    },
    async get(key) {
      try {
        return await readFile(pathFor(key));
      } catch {
        throw notFound();
      }
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const S3_TIMEOUT_MS = 20_000;

export class StorageError extends Error {}

export function createS3Store(settings: S3Settings, fetcher: typeof fetch = fetch): AttachmentStore {
  const endpoint = new URL(settings.endpoint);
  const credentials = { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey, region: settings.region };

  async function send(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer, mime?: string): Promise<Response> {
    assertKey(key);
    const objectPath = `${settings.prefix}${key}`;
    const url = new URL(`/${encodeKeyPath(settings.bucket)}/${encodeKeyPath(objectPath)}`, endpoint);
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH;
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(new Date()),
      ...(mime ? { 'content-type': mime } : {}),
    };
    const signed = signS3Request({ method, url, headers, payloadHash }, credentials);
    const sendable = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== 'host'));
    return fetcher(url, {
      method,
      headers: sendable,
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(S3_TIMEOUT_MS),
    });
  }

  return {
    async put(key, bytes, mime) {
      const response = await send('PUT', key, bytes, mime);
      if (!response.ok) throw new StorageError(`storage put failed with ${response.status}`);
    },
    async get(key) {
      const response = await send('GET', key);
      if (response.status === 404) throw notFound();
      if (!response.ok) throw new StorageError(`storage get failed with ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async remove(key) {
      const response = await send('DELETE', key);
      if (!response.ok && response.status !== 404) throw new StorageError(`storage delete failed with ${response.status}`);
    },
  };
}
