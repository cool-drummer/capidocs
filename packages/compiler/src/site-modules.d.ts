declare module '@capidocs/site/spec-utils' {
  import type { Spec } from '@capidocs/spec';

  export interface SearchEntry {
    type: 'page' | 'section' | 'endpoint';
    title: string;
    route: string;
    subtitle: string;
    text: string;
    anchor?: string;
    method?: string;
    path?: string;
  }

  export function slug(text: string): string;
  export function orderedRoutes(spec: Spec): { id: string; title: string }[];
  export function pageGroupMap(spec: Spec): Record<string, string>;
  export function stripTags(html: string): string;
  export function sectionText(section: unknown): string;
  export function buildSearchIndex(spec: Spec, labels?: { guide?: string; page?: string }): SearchEntry[];
  export function codeText(block: unknown): string;
  export function pageMarkdown(spec: Spec, route: string): string;
  export function pageSummary(spec: Spec, route: string, maxLength?: number): string;
}

declare module '@capidocs/site/diagram/model' {
  export interface DiagramIssue {
    path: string;
    message: string;
  }

  export interface Diagram {
    id: string;
    title: string;
    description?: string;
    kind: 'graph' | 'sequence';
    [key: string]: unknown;
  }

  export interface DiagramSet {
    version: number;
    title: string;
    description?: string;
    lang: string;
    categories: { id: string; title: string; description?: string; icon?: string; color: string }[];
    icons: Record<string, unknown>;
    start?: string;
    diagrams: Diagram[];
  }

  export type DiagramValidation =
    | { ok: true; set: DiagramSet; issues: [] }
    | { ok: false; set: null; issues: DiagramIssue[] };

  export const DIAGRAM_VERSION: number;
  export const LIMITS: Readonly<Record<string, number>> & { fileBytes: number; diagrams: number };
  export function validateDiagramSet(input: unknown): DiagramValidation;
  export function parseDiagramSetJson(source: string): DiagramValidation;
  export function mergeDiagramSets(base: DiagramSet, incoming: DiagramSet): DiagramValidation;
  export function serializeDiagramSet(set: DiagramSet): Record<string, unknown>;
  export function findDiagram(set: DiagramSet, diagramId: string): Diagram | null;
}

declare module '@capidocs/site/diagram/import' {
  import type { DiagramIssue, DiagramSet } from '@capidocs/site/diagram/model';

  export type ImportErrorCode = 'unsupported_format' | 'invalid_json' | 'invalid_model' | 'too_large' | 'empty' | 'parse_error';
  export type ImportFormat = 'json' | 'mermaid' | 'markdown' | 'drawio' | 'html' | 'svg';

  export interface ImportWarning {
    code: string;
    detail: string;
  }

  export interface ImportOptions {
    format?: ImportFormat;
    layout?: 'keep' | 'auto';
    lang?: string;
    title?: string;
  }

  export type ImportResult =
    | { ok: true; set: DiagramSet; warnings: ImportWarning[]; format: ImportFormat }
    | { ok: false; error: { code: ImportErrorCode; detail: string }; issues?: DiagramIssue[] };

  export const IMPORT_ERROR_CODES: ImportErrorCode[];
  export const IMPORT_FORMATS: ImportFormat[];
  export const IMPORT_EXTENSIONS: string[];
  export function detectFormat(text: string, name?: string): ImportFormat | undefined;
  export function importDiagramFile(file: { name?: string; text: string }, options?: ImportOptions): Promise<ImportResult>;
  export function importDiagramText(text: string, options?: ImportOptions & { hint?: string }): Promise<ImportResult>;
}

declare module '@capidocs/site/diagram/export/pdf' {
  export interface PdfText {
    x: number;
    y: number;
    size: number;
    text: string;
    width?: number;
  }

  export interface PdfPage {
    width: number;
    height: number;
    jpeg?: Uint8Array;
    imageWidth?: number;
    imageHeight?: number;
    texts?: PdfText[];
  }

  export function buildPdf(pages: PdfPage[], options?: { title?: string; lang?: string; producer?: string; creationDate?: Date }): Uint8Array;
}

declare module '@capidocs/site/diagram/export/standalone' {
  export const STANDALONE_IDS: { set: string; modules: string; root: string };

  export interface StandaloneOptions {
    set: unknown;
    title?: string;
    lang?: string;
    entry: string;
    readText?: (path: string) => Promise<string>;
    readBinary?: (path: string) => Promise<Uint8Array>;
    allowStyleAttributes?: boolean;
  }

  export function buildStandaloneHtml(options: StandaloneOptions): Promise<string>;
}
