import { useState } from 'react';
import { addBlock, BLOCK_LABEL, BLOCKS, blocksIn, moveItem, removeBlock, setBlock, type BlockKind, type Section } from '../blocks';
import { BlockEditor } from './block-editors';
import { RowActions, TextInput } from './fields';

function BlockPicker({ section, onPick }: { section: Section; onPick: (kind: BlockKind) => void }) {
  const [open, setOpen] = useState(false);
  const used = new Set(blocksIn(section));
  const available = BLOCKS.filter((block) => !used.has(block.kind));
  if (!available.length) return null;

  return (
    <div className="picker">
      <button type="button" className="button button-quiet" onClick={() => setOpen((value) => !value)}>
        Agregar bloque
      </button>
      {open ? (
        <div className="picker-menu">
          {available.map((block) => (
            <button
              key={block.kind}
              type="button"
              className="picker-item"
              onClick={() => {
                onPick(block.kind);
                setOpen(false);
              }}
            >
              <span className="picker-item-label">{block.label}</span>
              <span className="picker-item-hint">{block.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SectionEditor({
  section,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  section: Section;
  index: number;
  total: number;
  onChange: (section: Section) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const kinds = blocksIn(section);

  return (
    <section className="section-card">
      <header className="section-card-head">
        <TextInput value={section.title} onChange={(title) => onChange({ ...section, title })} placeholder="Título de la sección" />
        <RowActions
          onUp={index > 0 ? () => onMove(index, index - 1) : undefined}
          onDown={index < total - 1 ? () => onMove(index, index + 1) : undefined}
          onRemove={onRemove}
        />
      </header>

      {kinds.map((kind) => (
        <div className="block" key={kind}>
          <div className="block-head">
            <span className="block-name">{BLOCK_LABEL.get(kind)}</span>
            <button type="button" className="icon-button icon-button-danger" onClick={() => onChange(removeBlock(section, kind))} aria-label="Quitar bloque">
              ✕
            </button>
          </div>
          <BlockEditor kind={kind} value={section[kind]} onChange={(value) => onChange(setBlock(section, kind, value))} />
        </div>
      ))}

      <BlockPicker section={section} onPick={(kind) => onChange(addBlock(section, kind))} />
    </section>
  );
}

export function SectionList({ sections, onChange }: { sections: Section[]; onChange: (sections: Section[]) => void }) {
  return (
    <div className="section-list">
      {sections.map((section, index) => (
        <SectionEditor
          key={index}
          section={section}
          index={index}
          total={sections.length}
          onChange={(next) => onChange(sections.map((item, i) => (i === index ? next : item)))}
          onMove={(from, to) => onChange(moveItem(sections, from, to))}
          onRemove={() => onChange(sections.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}
