import { z } from 'zod';
import { badRequest } from './errors.js';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const RELATIVE_ASSET = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._/-]{1,200}$/;

export const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
export const displayNameSchema = z.string().trim().min(2).max(120);
export const slugSchema = z.string().trim().regex(/^[a-z0-9-]{2,50}$/);
export const titleSchema = z.string().trim().min(1).max(300);
export const iconSchema = z.string().trim().max(64).regex(/^[A-Za-z0-9 _:-]*$/);

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

export const webUrlSchema = z
  .string()
  .max(500)
  .refine((value) => ['https:', 'http:'].includes(protocolOf(value) ?? ''));

export const httpsUrlSchema = z
  .string()
  .max(500)
  .refine((value) => protocolOf(value) === 'https:');

const assetReference = z.union([z.string().regex(RELATIVE_ASSET), httpsUrlSchema]);

export const brandSchema = z
  .object({
    accent: z.object({ light: z.string().regex(HEX_COLOR), dark: z.string().regex(HEX_COLOR) }).strict().optional(),
    fonts: z
      .object({
        sans: z.string().max(100).optional(),
        headings: z.string().max(100).optional(),
        mono: z.string().max(100).optional(),
        imports: z.array(httpsUrlSchema).max(5).optional(),
      })
      .strict()
      .optional(),
    stylesheet: assetReference.optional(),
    logos: z
      .object({
        navbar_light: assetReference.optional(),
        navbar_dark: assetReference.optional(),
        hero: assetReference.optional(),
        icon: assetReference.optional(),
        footer: assetReference.optional(),
      })
      .strict()
      .optional(),
    useLogos: z.boolean().optional(),
    icon: iconSchema.optional(),
  })
  .strict();

export const accessConfigSchema = z
  .object({
    endpoint: httpsUrlSchema.optional(),
    contact: z.string().trim().max(200).optional(),
    portal_url: httpsUrlSchema.optional(),
    days: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export function assertWorkspaceLocale(locales: string[], locale: string): void {
  if (!locales.includes(locale)) throw badRequest('Ese idioma no está configurado en el espacio de trabajo.');
}
