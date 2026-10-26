import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, friendlyError, whenSessionEnds, type ApiError } from '../src/api';

function respond(status: number, body: string, contentType = 'application/json') {
  return vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } }));
}

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected a failure');
}

afterEach(() => {
  vi.unstubAllGlobals();
  whenSessionEnds(() => undefined);
});

describe('studio errors', () => {
  it('explains a network failure in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await failureOf(api.spaces());
    expect(error.message).toBe('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
  });

  it('never shows a proxy page or a parser error', async () => {
    vi.stubGlobal('fetch', respond(502, '<html><body>502 Bad Gateway nginx</body></html>', 'text/html'));
    const error = await failureOf(api.spaces());
    expect(error.message).toBe('Algo salió mal, inténtalo de nuevo en un momento.');
  });

  it('uses the friendly text of a known API error', async () => {
    vi.stubGlobal('fetch', respond(400, JSON.stringify({ error: 'weak_password', message: 'La contraseña debe tener al menos 12 caracteres.' })));
    const error = await failureOf(api.login('a@b.c', 'x'));
    expect(error.code).toBe('weak_password');
    expect(error.message).toBe('La contraseña debe tener al menos 12 caracteres.');
  });

  it('hides whatever a server error says', async () => {
    vi.stubGlobal('fetch', respond(500, JSON.stringify({ error: 'internal', message: 'relation "users" does not exist' })));
    expect((await failureOf(api.spaces())).message).toBe('Algo salió mal, inténtalo de nuevo en un momento.');
  });

  it('maps unknown failures by status', async () => {
    vi.stubGlobal('fetch', respond(429, ''));
    expect((await failureOf(api.spaces())).message).toBe('Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.');
  });

  it('turns anything that is not an API error into the generic message', () => {
    expect(friendlyError(new Error('Cannot read properties of undefined'))).toBe('Algo salió mal, inténtalo de nuevo en un momento.');
  });

  it('returns to the login screen when a session ends mid-work', async () => {
    const ended = vi.fn();
    whenSessionEnds(ended);
    vi.stubGlobal('fetch', respond(401, JSON.stringify({ error: 'unauthorized', message: 'Inicia sesión para continuar.' })));
    await failureOf(api.spaces());
    expect(ended).toHaveBeenCalledTimes(1);
    await failureOf(api.login('a@b.c', 'x'));
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

describe('csrf header', () => {
  it('is sent on mutations after login and never on reads', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify({ user: {}, csrfToken: 'token-123', spaces: [] }), { status: 200 });
      }),
    );
    await api.login('a@b.c', 'una-clave-bastante-larga');
    await api.spaces();
    await api.createSpace({ name: 'X' });
    const headers = calls.map((init) => (init.headers ?? {}) as Record<string, string>);
    expect(headers[1]!['X-CSRF-Token']).toBeUndefined();
    expect(headers[2]!['X-CSRF-Token']).toBe('token-123');
    await api.logout();
  });
});
