import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ApiError } from '../api';
import { api } from '../api';
import { Field, TextInput } from '../components/fields';

function PasswordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input className="input" type="password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="current-password" />;
}

export function LoginScreen({ onDone, onSetup }: { onDone: () => void; onSetup: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: onDone,
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <div className="access">
      <form
        className="access-card"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          login.mutate();
        }}
      >
        <div className="brand brand-large">
          <span className="brand-mark" />
          <span className="brand-name">Capidocs Studio</span>
        </div>
        <h1>Inicia sesión</h1>
        <Field label="Correo">
          <TextInput value={email} onChange={setEmail} placeholder="tu@correo.com" />
        </Field>
        <Field label="Contraseña">
          <PasswordInput value={password} onChange={setPassword} />
        </Field>
        {error ? <p className="status status-error">{error}</p> : null}
        <button type="submit" className="button button-primary button-wide" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" className="link-button" onClick={onSetup}>
          Configurar un espacio de trabajo nuevo
        </button>
      </form>
    </div>
  );
}

export function SetupScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const slug = workspaceName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const setup = useMutation({
    mutationFn: async () => {
      await api.setup({ workspaceName, workspaceSlug: slug, name, email, password, locales: ['es'] });
      return api.login(email, password);
    },
    onSuccess: onDone,
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <div className="access">
      <form
        className="access-card"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          setup.mutate();
        }}
      >
        <div className="brand brand-large">
          <span className="brand-mark" />
          <span className="brand-name">Capidocs Studio</span>
        </div>
        <h1>Crea tu espacio de trabajo</h1>
        <Field label="Nombre del espacio">
          <TextInput value={workspaceName} onChange={setWorkspaceName} placeholder="Mi empresa" />
        </Field>
        <Field label="Tu nombre">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="Correo">
          <TextInput value={email} onChange={setEmail} placeholder="tu@correo.com" />
        </Field>
        <Field label="Contraseña" hint="Al menos 10 caracteres">
          <PasswordInput value={password} onChange={setPassword} />
        </Field>
        {error ? <p className="status status-error">{error}</p> : null}
        <button type="submit" className="button button-primary button-wide" disabled={setup.isPending}>
          {setup.isPending ? 'Creando…' : 'Crear y entrar'}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Ya tengo una cuenta
        </button>
      </form>
    </div>
  );
}
