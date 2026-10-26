import { MAX_PASSWORD_LENGTH } from './auth.js';
import { ApiError } from './errors.js';

export const MIN_PASSWORD_LENGTH = 12;

const COMMON = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789abc',
  'abcdefghijkl',
  'qwertyuiopas',
  'qwertyuiop123',
  'qwerty123456',
  'password1234',
  'password12345',
  'passwordpassword',
  'contrasena123',
  'contraseña123',
  'contrasenacontrasena',
  'administrador',
  'administrator',
  'iloveyou1234',
  'teamo12345678',
  'welcome12345',
  'bienvenido123',
  'letmein12345',
  'changeme1234',
  'cambiame1234',
  '000000000000',
  '111111111111',
  'aaaaaaaaaaaa',
  'mexico123456',
  'capidocs1234',
  'studio123456',
]);

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function isSequential(password: string): boolean {
  const plain = normalize(password);
  return SEQUENCES.some((sequence) => sequence.includes(plain) || `${sequence}${sequence}`.includes(plain));
}

export interface PasswordContext {
  email?: string | null;
  name?: string | null;
  workspace?: string | null;
}

export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'La contraseña es demasiado larga.';

  const plain = normalize(password);
  if (new Set(plain).size < 5 || COMMON.has(plain) || isSequential(password)) {
    return 'Esa contraseña es muy fácil de adivinar. Usa una frase más larga o combina palabras poco comunes.';
  }

  const personal = [context.email?.split('@')[0], context.name, context.workspace]
    .filter((value): value is string => !!value)
    .map(normalize)
    .flatMap((value) => value.split(/[^a-z0-9]+/))
    .filter((value) => value.length >= 4);
  if (personal.some((value) => plain.includes(value))) {
    return 'La contraseña no debe incluir tu nombre, tu correo ni el nombre del espacio de trabajo.';
  }
  return null;
}

export function assertStrongPassword(password: string, context: PasswordContext = {}): void {
  const problem = passwordProblem(password, context);
  if (problem) throw new ApiError(400, 'weak_password', problem);
}
