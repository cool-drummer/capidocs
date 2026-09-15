import { sectionSchema, type Section } from '@capidocs/spec';
import { z } from 'zod';

export const documentSchema = z
  .object({
    version: z.literal(1),
    sections: z.array(sectionSchema),
  })
  .strict();

export type PageDocument = z.infer<typeof documentSchema>;

export const heroDocumentSchema = z
  .object({
    version: z.literal(1),
    hero: z.object({
      title: z.string().min(1),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      stats: z.array(z.object({ number: z.string(), label: z.string() }).strict()).optional(),
      buttons: z
        .array(z.object({ text: z.string().min(1), href: z.string().min(1), type: z.string().optional(), icon: z.string().optional() }).strict())
        .optional(),
    }),
    features: z
      .object({
        title: z.string().optional(),
        subtitle: z.string().optional(),
        items: z.array(z.object({ icon: z.string().optional(), title: z.string().min(1), description: z.string().optional(), link: z.string().optional() }).strict()),
      })
      .optional(),
  })
  .strict();

export type HeroDocument = z.infer<typeof heroDocumentSchema>;

export function emptyDocument(): PageDocument {
  return { version: 1, sections: [] };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function codeText(block: { code?: unknown; content?: unknown }): string {
  const raw = block.content ?? block.code;
  return Array.isArray(raw) ? raw.join('\n') : typeof raw === 'string' ? raw : '';
}

export function sectionToText(section: Section): string {
  const parts: string[] = [section.title];
  if (section.content) parts.push(section.content);
  if (section.prose) parts.push(stripTags(section.prose));
  if (section.note) parts.push(section.note);
  if (section.warning) parts.push(section.warning);
  if (section.list) parts.push(section.list.join(' '));
  if (section.table) parts.push(section.table.headers.join(' '), section.table.rows.flat().join(' '));
  if (section.callout) parts.push(section.callout.title ?? '', section.callout.content ?? '');
  if (section.cards) parts.push(section.cards.map((card) => `${card.title} ${card.description ?? ''}`).join(' '));
  if (section.steps) parts.push(section.steps.map((step) => `${step.title} ${step.description ?? ''}`).join(' '));
  if (section.accordion) parts.push(section.accordion.map((item) => `${item.title} ${item.content ?? ''}`).join(' '));
  if (section.tabs) parts.push(section.tabs.map((tab) => `${tab.label} ${tab.content ?? ''}`).join(' '));
  if (section.fields) parts.push(section.fields.map((field) => `${field.name} ${field.description ?? ''}`).join(' '));
  if (section.code) parts.push(codeText(section.code));
  if (section.code_group) parts.push(section.code_group.map(codeText).join(' '));
  if (section.image) parts.push(section.image.alt ?? '', section.image.caption ?? '');
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function documentToText(document: PageDocument): string {
  return document.sections.map(sectionToText).join('\n').trim();
}

export function heroToText(document: HeroDocument): string {
  const parts = [document.hero.title, document.hero.subtitle ?? '', document.hero.description ?? ''];
  if (document.features) {
    parts.push(document.features.title ?? '');
    parts.push(document.features.items.map((item) => `${item.title} ${item.description ?? ''}`).join(' '));
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function parseDocument(value: unknown, kind: 'page' | 'hero'): PageDocument | HeroDocument {
  return kind === 'hero' ? heroDocumentSchema.parse(value) : documentSchema.parse(value);
}

export function documentText(value: PageDocument | HeroDocument): string {
  return 'hero' in value ? heroToText(value) : documentToText(value);
}
