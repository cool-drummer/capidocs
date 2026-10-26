declare module '@capidocs/site/diagram/import' {
  export interface DiagramSummary {
    id: string;
    title: string;
  }

  export interface ImportedSet {
    title: string;
    diagrams: DiagramSummary[];
    [key: string]: unknown;
  }

  export type ImportResult =
    | { ok: true; set: ImportedSet; format: string; warnings: { code: string; detail: string }[] }
    | { ok: false; error: { code: string; detail: string }; issues?: { path: string; message: string }[] };

  export function importDiagramFile(file: { name: string; text: string }): Promise<ImportResult>;
}

declare module '@capidocs/site/diagram/model' {
  import type { ImportedSet } from '@capidocs/site/diagram/import';

  export function serializeDiagramSet(set: ImportedSet): ImportedSet;
}
