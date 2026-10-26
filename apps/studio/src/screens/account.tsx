import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendlyError } from '../api';
import { Field } from '../components/fields';

function PasswordField({ label, value, onChange, fresh, hint }: { label: string; value: string; onChange: (value: string) => void; fresh?: boolean; hint?: string }) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <input
        className="input"
        type="password"
        value={value}
        maxLength={256}
        autoComplete={fresh ? 'new-password' : 'current-password'}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function AccountPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage('Tu contraseña cambió. Cerramos tus otras sesiones y te enviamos un aviso por correo.');
    },
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        setMessage('');
        if (next !== confirm) {
          setError('Las contraseñas nuevas no coinciden.');
          return;
        }
        change.mutate();
      }}
    >
      <h3>Tu cuenta</h3>
      <PasswordField label="Contraseña actual" value={current} onChange={setCurrent} />
      <PasswordField label="Contraseña nueva" value={next} onChange={setNext} fresh hint="Al menos 12 caracteres. Una frase de varias palabras funciona bien." />
      <PasswordField label="Repite la contraseña nueva" value={confirm} onChange={setConfirm} fresh />
      {message ? <p className="status">{message}</p> : null}
      {error ? <p className="status status-error">{error}</p> : null}
      <div className="panel-actions">
        <button type="submit" className="button button-primary" disabled={change.isPending || !current || !next}>
          Cambiar la contraseña
        </button>
      </div>
    </form>
  );
}
