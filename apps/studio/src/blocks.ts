export type BlockKind =
  | 'content'
  | 'prose'
  | 'callout'
  | 'code'
  | 'list'
  | 'table'
  | 'cards'
  | 'steps'
  | 'fields'
  | 'accordion'
  | 'tabs'
  | 'code_group'
  | 'image'
  | 'note'
  | 'warning';

export interface BlockDefinition {
  kind: BlockKind;
  label: string;
  hint: string;
  create: () => unknown;
}

export const BLOCKS: BlockDefinition[] = [
  { kind: 'content', label: 'Texto', hint: 'Un párrafo simple', create: () => '' },
  { kind: 'prose', label: 'Texto enriquecido', hint: 'Negritas, enlaces y listas', create: () => '<p></p>' },
  { kind: 'callout', label: 'Aviso', hint: 'Nota, consejo o advertencia', create: () => ({ type: 'note', title: '', content: '' }) },
  { kind: 'code', label: 'Código', hint: 'Un bloque con resaltado', create: () => ({ language: 'bash', content: '' }) },
  { kind: 'code_group', label: 'Grupo de código', hint: 'Varios lenguajes en pestañas', create: () => [{ label: 'cURL', language: 'bash', content: '' }] },
  { kind: 'list', label: 'Lista', hint: 'Viñetas', create: () => [''] },
  { kind: 'table', label: 'Tabla', hint: 'Encabezados y filas', create: () => ({ headers: ['Columna'], rows: [['']] }) },
  { kind: 'cards', label: 'Tarjetas', hint: 'Enlaces destacados', create: () => [{ icon: 'fas fa-cube', title: '', description: '' }] },
  { kind: 'steps', label: 'Pasos', hint: 'Secuencia numerada', create: () => [{ number: '1', title: '', description: '' }] },
  { kind: 'fields', label: 'Campos', hint: 'Parámetros de una API', create: () => [{ name: '', type: 'string', required: false, description: '' }] },
  { kind: 'accordion', label: 'Acordeón', hint: 'Preguntas frecuentes', create: () => [{ title: '', content: '' }] },
  { kind: 'tabs', label: 'Pestañas', hint: 'Contenido alternativo', create: () => [{ label: 'Opción', content: '' }] },
  { kind: 'image', label: 'Imagen', hint: 'Captura con pie', create: () => ({ src: '', alt: '', caption: '' }) },
  { kind: 'note', label: 'Nota', hint: 'Recuadro breve', create: () => '' },
  { kind: 'warning', label: 'Advertencia', hint: 'Recuadro de cuidado', create: () => '' },
];

export const BLOCK_LABEL = new Map(BLOCKS.map((block) => [block.kind, block.label]));

export interface Section {
  title: string;
  [key: string]: unknown;
}

export function emptySection(): Section {
  return { title: 'Nueva sección', content: '' };
}

export function blocksIn(section: Section): BlockKind[] {
  return BLOCKS.filter((block) => section[block.kind] !== undefined).map((block) => block.kind);
}

export function addBlock(section: Section, kind: BlockKind): Section {
  const definition = BLOCKS.find((block) => block.kind === kind);
  if (!definition) return section;
  return { ...section, [kind]: definition.create() };
}

export function removeBlock(section: Section, kind: BlockKind): Section {
  const next = { ...section };
  delete next[kind];
  return next;
}

export function setBlock(section: Section, kind: BlockKind, value: unknown): Section {
  return { ...section, [kind]: value };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
