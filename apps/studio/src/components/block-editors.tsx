import type { BlockKind } from '../blocks';
import { moveItem } from '../blocks';
import { Field, RowActions, Select, TextArea, TextInput, Toggle } from './fields';

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function ListEditor({
  items,
  onChange,
  addLabel,
  create,
  render,
}: {
  items: Row[];
  onChange: (items: Row[]) => void;
  addLabel: string;
  create: () => Row;
  render: (item: Row, update: (patch: Row) => void) => React.ReactNode;
}) {
  return (
    <div className="list-editor">
      {items.map((item, index) => (
        <div className="list-row" key={index}>
          <div className="list-row-body">{render(item, (patch) => onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row))))}</div>
          <RowActions
            onUp={index > 0 ? () => onChange(moveItem(items, index, index - 1)) : undefined}
            onDown={index < items.length - 1 ? () => onChange(moveItem(items, index, index + 1)) : undefined}
            onRemove={() => onChange(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <button type="button" className="button button-quiet" onClick={() => onChange([...items, create()])}>
        {addLabel}
      </button>
    </div>
  );
}

export function BlockEditor({ kind, value, onChange }: { kind: BlockKind; value: unknown; onChange: (value: unknown) => void }) {
  if (kind === 'content' || kind === 'note' || kind === 'warning') {
    return <TextArea value={String(value ?? '')} onChange={onChange} rows={kind === 'content' ? 4 : 2} placeholder="Escribe aquí" />;
  }

  if (kind === 'prose') {
    return (
      <TextArea
        value={String(value ?? '')}
        onChange={onChange}
        rows={6}
        mono
        placeholder="<p>Usa <strong>negritas</strong> y <a href='...'>enlaces</a></p>"
      />
    );
  }

  if (kind === 'callout') {
    const callout = (value ?? {}) as Row;
    return (
      <div className="grid-2">
        <Field label="Tipo">
          <Select
            value={String(callout.type ?? 'note')}
            onChange={(next) => onChange({ ...callout, type: next })}
            options={[
              { value: 'note', label: 'Nota' },
              { value: 'info', label: 'Información' },
              { value: 'tip', label: 'Consejo' },
              { value: 'success', label: 'Listo' },
              { value: 'warning', label: 'Advertencia' },
              { value: 'danger', label: 'Peligro' },
            ]}
          />
        </Field>
        <Field label="Título">
          <TextInput value={String(callout.title ?? '')} onChange={(next) => onChange({ ...callout, title: next })} />
        </Field>
        <div className="grid-span">
          <Field label="Contenido">
            <TextArea value={String(callout.content ?? '')} onChange={(next) => onChange({ ...callout, content: next })} rows={3} />
          </Field>
        </div>
      </div>
    );
  }

  if (kind === 'code') {
    const code = (value ?? {}) as Row;
    return (
      <div className="grid-2">
        <Field label="Lenguaje">
          <TextInput value={String(code.language ?? '')} onChange={(next) => onChange({ ...code, language: next })} mono />
        </Field>
        <Field label="Título">
          <TextInput value={String(code.title ?? '')} onChange={(next) => onChange({ ...code, title: next })} />
        </Field>
        <div className="grid-span">
          <Field label="Código">
            <TextArea value={String(code.content ?? '')} onChange={(next) => onChange({ ...code, content: next })} rows={7} mono />
          </Field>
        </div>
      </div>
    );
  }

  if (kind === 'code_group') {
    return (
      <ListEditor
        items={asRows(value)}
        onChange={onChange}
        addLabel="Agregar lenguaje"
        create={() => ({ label: '', language: 'bash', content: '' })}
        render={(item, update) => (
          <div className="grid-2">
            <Field label="Etiqueta">
              <TextInput value={String(item.label ?? '')} onChange={(next) => update({ label: next })} />
            </Field>
            <Field label="Lenguaje">
              <TextInput value={String(item.language ?? '')} onChange={(next) => update({ language: next })} mono />
            </Field>
            <div className="grid-span">
              <TextArea value={String(item.content ?? '')} onChange={(next) => update({ content: next })} rows={5} mono />
            </div>
          </div>
        )}
      />
    );
  }

  if (kind === 'list') {
    const items = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="list-editor">
        {items.map((item, index) => (
          <div className="list-row" key={index}>
            <div className="list-row-body">
              <TextInput value={item} onChange={(next) => onChange(items.map((row, i) => (i === index ? next : row)))} />
            </div>
            <RowActions
              onUp={index > 0 ? () => onChange(moveItem(items, index, index - 1)) : undefined}
              onDown={index < items.length - 1 ? () => onChange(moveItem(items, index, index + 1)) : undefined}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <button type="button" className="button button-quiet" onClick={() => onChange([...items, ''])}>
          Agregar viñeta
        </button>
      </div>
    );
  }

  if (kind === 'table') {
    const table = (value ?? { headers: [], rows: [] }) as { headers: string[]; rows: string[][] };
    const setHeaders = (headers: string[]) => onChange({ ...table, headers });
    const setRows = (rows: string[][]) => onChange({ ...table, rows });
    return (
      <div className="table-editor">
        <div className="table-editor-row">
          {table.headers.map((header, index) => (
            <TextInput
              key={index}
              value={header}
              onChange={(next) => setHeaders(table.headers.map((item, i) => (i === index ? next : item)))}
            />
          ))}
          <button
            type="button"
            className="icon-button"
            aria-label="Agregar columna"
            onClick={() => {
              setHeaders([...table.headers, '']);
              setRows(table.rows.map((row) => [...row, '']));
            }}
          >
            +
          </button>
        </div>
        {table.rows.map((row, rowIndex) => (
          <div className="table-editor-row" key={rowIndex}>
            {table.headers.map((_, columnIndex) => (
              <TextInput
                key={columnIndex}
                value={row[columnIndex] ?? ''}
                onChange={(next) =>
                  setRows(table.rows.map((current, i) => (i === rowIndex ? current.map((cell, j) => (j === columnIndex ? next : cell)) : current)))
                }
              />
            ))}
            <button
              type="button"
              className="icon-button icon-button-danger"
              aria-label="Quitar fila"
              onClick={() => setRows(table.rows.filter((_, i) => i !== rowIndex))}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="button button-quiet" onClick={() => setRows([...table.rows, table.headers.map(() => '')])}>
          Agregar fila
        </button>
      </div>
    );
  }

  if (kind === 'cards') {
    return (
      <ListEditor
        items={asRows(value)}
        onChange={onChange}
        addLabel="Agregar tarjeta"
        create={() => ({ icon: 'fas fa-cube', title: '', description: '' })}
        render={(item, update) => (
          <div className="grid-2">
            <Field label="Título">
              <TextInput value={String(item.title ?? '')} onChange={(next) => update({ title: next })} />
            </Field>
            <Field label="Ícono">
              <TextInput value={String(item.icon ?? '')} onChange={(next) => update({ icon: next })} mono />
            </Field>
            <div className="grid-span">
              <Field label="Descripción">
                <TextArea value={String(item.description ?? '')} onChange={(next) => update({ description: next })} rows={2} />
              </Field>
            </div>
          </div>
        )}
      />
    );
  }

  if (kind === 'steps') {
    return (
      <ListEditor
        items={asRows(value)}
        onChange={onChange}
        addLabel="Agregar paso"
        create={() => ({ number: '', title: '', description: '' })}
        render={(item, update) => (
          <div className="grid-2">
            <Field label="Número">
              <TextInput value={String(item.number ?? '')} onChange={(next) => update({ number: next })} />
            </Field>
            <Field label="Título">
              <TextInput value={String(item.title ?? '')} onChange={(next) => update({ title: next })} />
            </Field>
            <div className="grid-span">
              <Field label="Descripción">
                <TextArea value={String(item.description ?? '')} onChange={(next) => update({ description: next })} rows={2} />
              </Field>
            </div>
          </div>
        )}
      />
    );
  }

  if (kind === 'fields') {
    return (
      <ListEditor
        items={asRows(value)}
        onChange={onChange}
        addLabel="Agregar campo"
        create={() => ({ name: '', type: 'string', required: false, description: '' })}
        render={(item, update) => (
          <div className="grid-3">
            <Field label="Nombre">
              <TextInput value={String(item.name ?? '')} onChange={(next) => update({ name: next })} mono />
            </Field>
            <Field label="Tipo">
              <TextInput value={String(item.type ?? '')} onChange={(next) => update({ type: next })} mono />
            </Field>
            <Toggle checked={!!item.required} onChange={(next) => update({ required: next })} label="Requerido" />
            <div className="grid-span">
              <Field label="Descripción">
                <TextInput value={String(item.description ?? '')} onChange={(next) => update({ description: next })} />
              </Field>
            </div>
          </div>
        )}
      />
    );
  }

  if (kind === 'accordion' || kind === 'tabs') {
    const labelKey = kind === 'tabs' ? 'label' : 'title';
    return (
      <ListEditor
        items={asRows(value)}
        onChange={onChange}
        addLabel={kind === 'tabs' ? 'Agregar pestaña' : 'Agregar entrada'}
        create={() => ({ [labelKey]: '', content: '' })}
        render={(item, update) => (
          <div className="grid-1">
            <Field label={kind === 'tabs' ? 'Etiqueta' : 'Título'}>
              <TextInput value={String(item[labelKey] ?? '')} onChange={(next) => update({ [labelKey]: next })} />
            </Field>
            <Field label="Contenido">
              <TextArea value={String(item.content ?? '')} onChange={(next) => update({ content: next })} rows={3} />
            </Field>
          </div>
        )}
      />
    );
  }

  if (kind === 'image') {
    const image = (value ?? {}) as Row;
    return (
      <div className="grid-2">
        <Field label="Ruta">
          <TextInput value={String(image.src ?? '')} onChange={(next) => onChange({ ...image, src: next })} mono placeholder="assets/img/panel.png" />
        </Field>
        <Field label="Texto alternativo">
          <TextInput value={String(image.alt ?? '')} onChange={(next) => onChange({ ...image, alt: next })} />
        </Field>
        <div className="grid-span">
          <Field label="Pie de imagen">
            <TextInput value={String(image.caption ?? '')} onChange={(next) => onChange({ ...image, caption: next })} />
          </Field>
        </div>
      </div>
    );
  }

  return null;
}
