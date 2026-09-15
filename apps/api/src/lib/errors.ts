export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(statusCode: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (message: string, detail?: unknown) => new ApiError(400, 'bad_request', message, detail);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Inicia sesión para continuar.');
export const forbidden = () => new ApiError(403, 'forbidden', 'No tienes permiso para hacer esto.');
export const notFound = () => new ApiError(404, 'not_found', 'No encontramos lo que buscas.');
export const conflict = (message: string) => new ApiError(409, 'conflict', message);

export const FRIENDLY: Record<string, string> = {
  bad_request: 'Revisa los datos e inténtalo de nuevo.',
  unauthorized: 'Inicia sesión para continuar.',
  forbidden: 'No tienes permiso para hacer esto.',
  not_found: 'No encontramos lo que buscas.',
  conflict: 'Ese valor ya está en uso.',
  internal: 'Algo salió mal, inténtalo de nuevo en un momento.',
};
