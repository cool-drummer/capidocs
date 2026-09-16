import type { ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      className={mono ? 'input input-mono' : 'input'}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={!mono}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <textarea
      className={mono ? 'input input-mono' : 'input'}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      spellCheck={!mono}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function RowActions({
  onUp,
  onDown,
  onRemove,
}: {
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="row-actions">
      {onUp ? (
        <button type="button" className="icon-button" onClick={onUp} aria-label="Subir">
          ↑
        </button>
      ) : null}
      {onDown ? (
        <button type="button" className="icon-button" onClick={onDown} aria-label="Bajar">
          ↓
        </button>
      ) : null}
      <button type="button" className="icon-button icon-button-danger" onClick={onRemove} aria-label="Quitar">
        ✕
      </button>
    </div>
  );
}
