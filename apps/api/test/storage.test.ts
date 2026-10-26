import { describe, expect, it } from 'vitest';
import { EMPTY_PAYLOAD_HASH, encodeKeyPath, sha256Hex, signS3Request } from '../src/lib/s3.js';
import { createS3Store } from '../src/lib/storage.js';

const EXAMPLE = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
const KEY = `${'a'.repeat(32)}.png`;

describe('signature version 4', () => {
  it('matches the reference GET example from the S3 documentation', () => {
    const signed = signS3Request(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { Host: 'examplebucket.s3.amazonaws.com', Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_PAYLOAD_HASH, 'x-amz-date': '20130524T000000Z' },
        payloadHash: EMPTY_PAYLOAD_HASH,
      },
      EXAMPLE,
    );
    expect(signed.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the reference PUT example, including key encoding', () => {
    const payloadHash = sha256Hex('Welcome to Amazon S3.');
    const signed = signS3Request(
      {
        method: 'PUT',
        url: new URL(`https://examplebucket.s3.amazonaws.com/${encodeKeyPath('test$file.text')}`),
        headers: {
          Host: 'examplebucket.s3.amazonaws.com',
          Date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-date': '20130524T000000Z',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
          'x-amz-content-sha256': payloadHash,
        },
        payloadHash,
      },
      EXAMPLE,
    );
    expect(signed.Authorization).toMatch(/Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
  });
});

describe('s3 store', () => {
  const settings = {
    endpoint: 'https://nyc3.digitaloceanspaces.com',
    region: 'nyc3',
    bucket: 'studio-files',
    prefix: 'attachments/',
    accessKeyId: 'key-id',
    secretAccessKey: 'key-secret',
  };

  function recordingFetch(status = 200, body = '') {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(status === 204 ? null : body, { status });
    }) as typeof fetch;
    return { calls, fetcher };
  }

  it('puts a private object with a signed, path-style request', async () => {
    const { calls, fetcher } = recordingFetch();
    await createS3Store(settings, fetcher).put(KEY, Buffer.from('bytes'), 'image/png');
    const { url, init } = calls[0]!;
    expect(url).toBe(`https://nyc3.digitaloceanspaces.com/studio-files/attachments/${KEY}`);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/nyc3\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex('bytes'));
    expect(headers).not.toHaveProperty('host');
    expect(JSON.stringify(headers)).not.toContain('key-secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a missing object to not found and reads existing bytes', async () => {
    const missing = recordingFetch(404);
    await expect(createS3Store(settings, missing.fetcher).get(KEY)).rejects.toMatchObject({ statusCode: 404 });
    const present = recordingFetch(200, 'hello');
    expect((await createS3Store(settings, present.fetcher).get(KEY)).toString()).toBe('hello');
  });

  it('refuses keys that are not opaque storage keys', async () => {
    const { calls, fetcher } = recordingFetch();
    await expect(createS3Store(settings, fetcher).get('../secrets.env')).rejects.toMatchObject({ statusCode: 404 });
    expect(calls).toHaveLength(0);
  });

  it('reports a storage failure without exposing credentials', async () => {
    const { fetcher } = recordingFetch(403);
    await expect(createS3Store(settings, fetcher).put(KEY, Buffer.from('x'), 'image/png')).rejects.toThrow('storage put failed with 403');
  });
});
