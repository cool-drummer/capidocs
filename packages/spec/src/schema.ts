import { z } from 'zod';

const nonEmpty = z.string().min(1);
const anyValue = z.unknown();

const codeSource = {
  file: nonEmpty.optional(),
  code_file: nonEmpty.optional(),
  language: nonEmpty.optional(),
  title: z.string().optional(),
};

const codeText = z.union([z.string(), z.array(z.string()).min(1)]);

export const codeBlockSchema = z
  .object({
    ...codeSource,
    content: codeText.optional(),
    code: codeText.optional(),
  })
  .strict();

export const calloutSchema = z
  .object({
    type: z.enum(['note', 'info', 'tip', 'success', 'check', 'warning', 'danger', 'error']).optional(),
    title: z.string().optional(),
    content: z.string().optional(),
  })
  .strict();

export const cardSchema = z
  .object({
    icon: z.string().optional(),
    title: nonEmpty,
    description: z.string().optional(),
    link: z.string().optional(),
  })
  .strict();

export const tabSchema = z
  .object({
    label: nonEmpty,
    content: z.string().optional(),
    code: codeBlockSchema.optional(),
  })
  .strict();

export const accordionItemSchema = z
  .object({
    title: nonEmpty,
    content: z.string().optional(),
  })
  .strict();

export const codeGroupItemSchema = z
  .object({
    ...codeSource,
    label: z.string().optional(),
    content: codeText.optional(),
    code: codeText.optional(),
  })
  .strict();

export const fieldSchema = z
  .object({
    name: nonEmpty,
    type: z.string().optional(),
    required: z.boolean().optional(),
    default: anyValue.optional(),
    description: z.string().optional(),
  })
  .strict();

export const stepSchema = z
  .object({
    number: z.union([z.string(), z.number()]),
    title: nonEmpty,
    description: z.string().optional(),
    link: z.string().optional(),
    duration: z.string().optional(),
  })
  .strict();

export const tableSchema = z
  .object({
    headers: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  })
  .strict();

export const imageSchema = z
  .object({
    src: nonEmpty,
    alt: z.string().optional(),
    caption: z.string().optional(),
  })
  .strict();

export const sectionSchema = z
  .object({
    title: nonEmpty,
    content: z.string().optional(),
    prose: z.string().optional(),
    note: z.string().optional(),
    warning: z.string().optional(),
    list: z.array(z.string()).optional(),
    table: tableSchema.optional(),
    code: codeBlockSchema.optional(),
    steps: z.array(stepSchema).optional(),
    callout: calloutSchema.optional(),
    cards: z.array(cardSchema).optional(),
    tabs: z.array(tabSchema).optional(),
    accordion: z.array(accordionItemSchema).optional(),
    code_group: z.array(codeGroupItemSchema).optional(),
    fields: z.array(fieldSchema).optional(),
    image: imageSchema.optional(),
  })
  .strict();

export const heroSchema = z
  .object({
    title: nonEmpty,
    subtitle: z.string().optional(),
    description: z.string().optional(),
    base_url: z.string().optional(),
    note: z.string().optional(),
    audience: z.string().optional(),
    confidentiality: z.string().optional(),
    stats: z.array(z.object({ number: z.string(), label: z.string() }).strict()).optional(),
    buttons: z
      .array(
        z
          .object({
            text: nonEmpty,
            href: nonEmpty,
            type: z.string().optional(),
            icon: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const titledList = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      items: z.array(item),
    })
    .strict();

export const featureItemSchema = z
  .object({
    icon: z.string().optional(),
    title: nonEmpty,
    description: z.string().optional(),
    link: z.string().optional(),
  })
  .strict();

export const quickStartSchema = z
  .object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    code: codeBlockSchema.optional(),
    response: codeBlockSchema.optional(),
    error_response: codeBlockSchema.optional(),
  })
  .strict();

export const heroPageSchema = z
  .object({
    template: z.literal('hero'),
    content: z
      .object({
        hero: heroSchema,
        features: titledList(featureItemSchema).optional(),
        steps: titledList(stepSchema).optional(),
        quick_start: quickStartSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const contentPageSchema = z
  .object({
    template: z.literal('content'),
    content: z
      .object({
        title: nonEmpty,
        description: z.string().optional(),
        sections: z.array(sectionSchema).optional(),
      })
      .strict(),
  })
  .strict();

export const pageSchema = z.discriminatedUnion('template', [heroPageSchema, contentPageSchema]);

const jsonSchemaProperty: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      description: z.string().optional(),
      example: anyValue.optional(),
      properties: z.record(z.string(), jsonSchemaProperty).optional(),
      items: jsonSchemaProperty.optional(),
      required: z.array(z.string()).optional(),
      enum: z.array(anyValue).optional(),
      format: z.string().optional(),
      default: anyValue.optional(),
    })
    .strict(),
);

export const bodySchemaSchema = z
  .object({
    type: z.string().optional(),
    properties: z.record(z.string(), jsonSchemaProperty).optional(),
    required: z.array(z.string()).optional(),
  })
  .strict();

export const headerParamSchema = z
  .object({
    name: nonEmpty,
    value: z.string().optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict();

export const queryParamSchema = z
  .object({
    name: nonEmpty,
    type: z.string().optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    example: anyValue.optional(),
    default: anyValue.optional(),
  })
  .strict();

export const codeExampleSchema = z
  .object({
    ...codeSource,
    id: z.string().optional(),
    tech: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    code: codeText.optional(),
    content: codeText.optional(),
  })
  .strict();

export const responseSchema = z
  .object({
    description: z.string().optional(),
    schema: bodySchemaSchema.optional(),
    examples: z
      .record(z.string(), z.object({ summary: z.string().optional(), value: anyValue }).strict())
      .optional(),
  })
  .strict();

export const endpointSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    path: nonEmpty,
    title: nonEmpty,
    description: z.string().optional(),
    authentication: z.boolean().optional(),
    request: z
      .object({
        headers: z.array(headerParamSchema).optional(),
        query_params: z.array(queryParamSchema).optional(),
        body: z
          .object({
            type: z.string().optional(),
            schema: bodySchemaSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    responses: z.record(z.string().regex(/^\d{3}$/), responseSchema).optional(),
    code_examples: z.array(codeExampleSchema).optional(),
  })
  .strict();

export const navigationItemSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    icon: z.string().optional(),
    type: z.literal('page').optional(),
  })
  .strict();

export const sectionNavSchema = z
  .object({
    title: nonEmpty,
    icon: z.string().optional(),
    pages: z
      .array(z.object({ id: nonEmpty, title: nonEmpty, icon: z.string().optional() }).strict())
      .optional(),
    endpoints: z
      .array(
        z
          .object({
            id: nonEmpty,
            title: nonEmpty,
            method: z.string().optional(),
            path: z.string().optional(),
            icon: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/);

export const themeSchema = z
  .object({
    accent: z.object({ light: hexColor, dark: hexColor }).strict().optional(),
    stylesheet: nonEmpty.optional(),
    fonts: z
      .object({
        sans: z.string().optional(),
        headings: z.string().optional(),
        mono: z.string().optional(),
        imports: z.array(z.string().url()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const accessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('open') }).strict(),
  z
    .object({
      mode: z.literal('gate'),
      endpoint: z.string().url(),
      brand: z.string().optional(),
      contact: z.string().optional(),
      days: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('accounts'),
      portal_url: z.string().url(),
    })
    .strict(),
]);

export const siteConfigSchema = z
  .object({
    name: z.string().optional(),
    brand: z.string().optional(),
    brand_icon: z.string().optional(),
    use_logos: z.boolean().optional(),
    logos: z
      .object({
        navbar_light: z.string().optional(),
        navbar_dark: z.string().optional(),
        hero: z.string().optional(),
        icon: z.string().optional(),
        footer: z.string().optional(),
      })
      .strict()
      .optional(),
    default_theme: z.enum(['system', 'auto', 'light', 'dark']).optional(),
    theme: themeSchema.optional(),
    access: accessSchema.optional(),
    license: z.object({ text: z.string(), link: z.string().optional() }).strict().optional(),
    show_warning_on_pages: z.boolean().optional(),
    exclude_warning_routes: z.array(z.string()).optional(),
    warning_message: z
      .object({ title: z.string().optional(), content: z.string().optional(), type: z.string().optional() })
      .strict()
      .optional(),
    toc: z
      .object({
        enabled: z.boolean().optional(),
        min_headings: z.number().int().optional(),
        exclude_pages: z.array(z.string()).optional(),
        exclude_headings: z
          .object({ texts: z.array(z.string()).optional(), selectors: z.array(z.string()).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    page_titles: z
      .object({
        base_title: z.string().optional(),
        separator: z.string().optional(),
        routes: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    navbar: z
      .object({
        tabs: z
          .array(z.object({ text: nonEmpty, icon: z.string().optional(), groups: z.array(z.string()) }).strict())
          .optional(),
        links: z
          .array(z.object({ text: nonEmpty, href: nonEmpty, icon: z.string().optional() }).strict())
          .optional(),
        cta: z.object({ text: z.string().optional(), href: z.string().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    lang: z.string().optional(),
    languages: z
      .array(z.object({ code: nonEmpty, label: nonEmpty, spec: nonEmpty }).strict())
      .optional(),
    versions: z
      .array(z.object({ label: nonEmpty, spec: z.string().optional(), url: z.string().optional() }).strict())
      .optional(),
    site_url: z.string().optional(),
    ui: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const specSchema = z
  .object({
    site_config: siteConfigSchema,
    api: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        base_url: z.string().optional(),
      })
      .strict()
      .optional(),
    navigation: z.array(navigationItemSchema).optional(),
    sections: z.array(sectionNavSchema).optional(),
    pages: z.record(z.string(), pageSchema),
    endpoints: z.record(z.string(), endpointSchema).optional(),
    features: z.record(z.string(), z.boolean()).optional(),
    theme: z.object({ colors: z.record(z.string(), z.string()) }).strict().optional(),
  })
  .strict();

export type Spec = z.infer<typeof specSchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type CodeBlock = z.infer<typeof codeBlockSchema>;
