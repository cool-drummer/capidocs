import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, friendlyError } from '../api';
import { Field, TextInput } from '../components/fields';

const PASSWORD_HINT = 'Al menos 12 caracteres. Una frase de varias palabras es fácil de recordar y difícil de adivinar.';

function PasswordInput({ value, onChange, fresh = false, autoComplete }: { value: string; onChange: (value: string) => void; fresh?: boolean; autoComplete?: string }) {
  return (
    <input
      className="input"
      type="password"
      value={value}
      maxLength={256}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete ?? (fresh ? 'new-password' : 'current-password')}
    />
  );
}

function AccessCard({ title, onSubmit, children }: { title: string; onSubmit: () => void; children: ReactNode }) {
  return (
    <div className="access">
      <form
        className="access-card"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="brand brand-large">
          <span className="brand-mark" />
          <span className="brand-name">Capidocs Studio</span>
        </div>
        <h1>{title}</h1>
        {children}
      </form>
    </div>
  );
}

export function LoginScreen({ onDone, onSetup, onForgot }: { onDone: () => void; onSetup: () => void; onForgot: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: onDone,
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <AccessCard
      title="Inicia sesión"
      onSubmit={() => {
        setError('');
        login.mutate();
      }}
    >
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
      <button type="button" className="link-button" onClick={onForgot}>
        Olvidé mi contraseña
      </button>
      <button type="button" className="link-button" onClick={onSetup}>
        Configurar un espacio de trabajo nuevo
      </button>
    </AccessCard>
  );
}

export function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const request = useMutation({
    mutationFn: () => api.forgotPassword(email),
    onSuccess: () => setSent(true),
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <AccessCard
      title="Recupera tu contraseña"
      onSubmit={() => {
        setError('');
        request.mutate();
      }}
    >
      {sent ? (
        <p className="status">Si el correo pertenece a una cuenta, te enviamos un enlace para elegir una contraseña nueva. Revisa tu bandeja de entrada.</p>
      ) : (
        <>
          <Field label="Correo">
            <TextInput value={email} onChange={setEmail} placeholder="tu@correo.com" />
          </Field>
          {error ? <p className="status status-error">{error}</p> : null}
          <button type="submit" className="button button-primary button-wide" disabled={request.isPending || !email}>
            {request.isPending ? 'Enviando…' : 'Enviar el enlace'}
          </button>
        </>
      )}
      <button type="button" className="link-button" onClick={onBack}>
        Volver a iniciar sesión
      </button>
    </AccessCard>
  );
}

export function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const reset = useMutation({
    mutationFn: () => api.resetPassword(token, password),
    onSuccess: () => setDone(true),
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <AccessCard
      title="Elige una contraseña nueva"
      onSubmit={() => {
        setError('');
        if (password !== confirm) {
          setError('Las contraseñas no coinciden.');
          return;
        }
        reset.mutate();
      }}
    >
      {done ? (
        <p className="status">Tu contraseña quedó lista y cerramos tus sesiones abiertas. Ya puedes iniciar sesión.</p>
      ) : (
        <>
          <Field label="Contraseña nueva" hint={PASSWORD_HINT}>
            <PasswordInput value={password} onChange={setPassword} fresh />
          </Field>
          <Field label="Repite la contraseña">
            <PasswordInput value={confirm} onChange={setConfirm} fresh />
          </Field>
          {error ? <p className="status status-error">{error}</p> : null}
          <button type="submit" className="button button-primary button-wide" disabled={reset.isPending || !password}>
            {reset.isPending ? 'Guardando…' : 'Guardar la contraseña'}
          </button>
        </>
      )}
      <button type="button" className="link-button" onClick={onDone}>
        Ir a iniciar sesión
      </button>
    </AccessCard>
  );
}

export function AcceptInvitationScreen({ token, onDone, onCancel }: { token: string; onDone: () => void; onCancel: () => void }) {
  const invitation = useQuery({ queryKey: ['invitation', token], queryFn: () => api.invitation(token), retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token, name, password),
    onSuccess: onDone,
    onError: (err) => setError(friendlyError(err)),
  });

  if (invitation.isLoading) return <div className="access"><p className="placeholder">Cargando la invitación…</p></div>;

  return (
    <AccessCard
      title={invitation.data ? `Únete a ${invitation.data.workspace}` : 'Invitación'}
      onSubmit={() => {
        setError('');
        accept.mutate();
      }}
    >
      {invitation.error ? (
        <p className="status status-error">{friendlyError(invitation.error)}</p>
      ) : (
        <>
          <p className="status">Vas a entrar como {invitation.data?.email}.</p>
          <Field label="Tu nombre">
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label="Contraseña" hint={PASSWORD_HINT}>
            <PasswordInput value={password} onChange={setPassword} fresh />
          </Field>
          {error ? <p className="status status-error">{error}</p> : null}
          <button type="submit" className="button button-primary button-wide" disabled={accept.isPending || !name || !password}>
            {accept.isPending ? 'Entrando…' : 'Aceptar y entrar'}
          </button>
        </>
      )}
      <button type="button" className="link-button" onClick={onCancel}>
        Ir a iniciar sesión
      </button>
    </AccessCard>
  );
}

export function SetupScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');

  const slug = workspaceName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const setup = useMutation({
    mutationFn: async () => {
      await api.setup({ workspaceName, workspaceSlug: slug, name, email, password, locales: ['es'], ...(setupToken ? { setupToken } : {}) });
      return api.login(email, password);
    },
    onSuccess: onDone,
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <AccessCard
      title="Crea tu espacio de trabajo"
      onSubmit={() => {
        setError('');
        setup.mutate();
      }}
    >
      <Field label="Nombre del espacio">
        <TextInput value={workspaceName} onChange={setWorkspaceName} placeholder="Mi empresa" />
      </Field>
      <Field label="Tu nombre">
        <TextInput value={name} onChange={setName} />
      </Field>
      <Field label="Correo">
        <TextInput value={email} onChange={setEmail} placeholder="tu@correo.com" />
      </Field>
      <Field label="Contraseña" hint={PASSWORD_HINT}>
        <PasswordInput value={password} onChange={setPassword} fresh />
      </Field>
      <Field label="Código de configuración" hint="Lo entrega quien administra el servidor">
        <PasswordInput value={setupToken} onChange={setSetupToken} autoComplete="one-time-code" />
      </Field>
      {error ? <p className="status status-error">{error}</p> : null}
      <button type="submit" className="button button-primary button-wide" disabled={setup.isPending}>
        {setup.isPending ? 'Creando…' : 'Crear y entrar'}
      </button>
      <button type="button" className="link-button" onClick={onCancel}>
        Ya tengo una cuenta
      </button>
    </AccessCard>
  );
}
