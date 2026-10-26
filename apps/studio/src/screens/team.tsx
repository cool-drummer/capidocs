import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ApiError } from '../api';
import { api } from '../api';
import { Field, Select, TextInput } from '../components/fields';

const ROLE_LABEL: Record<string, string> = { owner: 'Dueña', admin: 'Administra', member: 'Miembro' };

export function TeamPanel() {
  const client = useQueryClient();
  const team = useQuery({ queryKey: ['members'], queryFn: api.members });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invite = useMutation({
    mutationFn: () => api.invite(email, role),
    onSuccess: () => {
      setEmail('');
      setMessage('Invitación enviada por correo.');
      void client.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['members'] }),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: 'admin' | 'member' }) => api.setMemberRole(userId, next),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['members'] }),
    onError: (err: ApiError) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(userId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['members'] }),
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <div className="panel">
      <h3>Equipo</h3>
      {(team.data?.members ?? []).map((member) => (
        <div className="member-row" key={member.userId}>
          <div>
            <div className="member-name">{member.name}</div>
            <div className="member-email">{member.email}</div>
          </div>
          <div className="row-actions">
            {member.role === 'owner' ? (
              <span className="chip">{ROLE_LABEL.owner}</span>
            ) : (
              <>
                <Select
                  value={member.role}
                  onChange={(next) => changeRole.mutate({ userId: member.userId, next: next as 'admin' | 'member' })}
                  options={[
                    { value: 'member', label: ROLE_LABEL.member! },
                    { value: 'admin', label: ROLE_LABEL.admin! },
                  ]}
                />
                <button type="button" className="icon-button icon-button-danger" aria-label="Quitar" onClick={() => remove.mutate(member.userId)}>
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      {(team.data?.invitations ?? []).length ? <div className="sidebar-label">Invitaciones pendientes</div> : null}
      {(team.data?.invitations ?? []).map((invitation) => (
        <div className="member-row" key={invitation.id}>
          <div>
            <div className="member-name">{invitation.email}</div>
            <div className="member-email">Invitada como {ROLE_LABEL[invitation.role] ?? invitation.role}</div>
          </div>
          <button type="button" className="icon-button icon-button-danger" aria-label="Cancelar invitación" onClick={() => revoke.mutate(invitation.id)}>
            ✕
          </button>
        </div>
      ))}

      <form
        className="portal-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          setMessage('');
          invite.mutate();
        }}
      >
        <Field label="Invitar por correo">
          <TextInput value={email} onChange={setEmail} placeholder="persona@empresa.com" />
        </Field>
        <Field label="Rol">
          <Select
            value={role}
            onChange={(value) => setRole(value as 'admin' | 'member')}
            options={[
              { value: 'member', label: 'Miembro' },
              { value: 'admin', label: 'Administra' },
            ]}
          />
        </Field>
        <button type="submit" className="button button-quiet" disabled={invite.isPending || !email}>
          Enviar invitación
        </button>
      </form>
      {message ? <p className="status">{message}</p> : null}
      {error ? <p className="status status-error">{error}</p> : null}
    </div>
  );
}

export function SpaceMembersPanel({ spaceId }: { spaceId: string }) {
  const client = useQueryClient();
  const team = useQuery({ queryKey: ['members'], queryFn: api.members });
  const spaceMembers = useQuery({ queryKey: ['space-members', spaceId], queryFn: () => api.spaceMembers(spaceId) });
  const [error, setError] = useState('');

  const grant = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'writer' | 'reader' }) => api.setSpaceMember(spaceId, userId, role),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['space-members', spaceId] }),
    onError: (err: ApiError) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) => api.removeSpaceMember(spaceId, userId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['space-members', spaceId] }),
  });

  const assigned = new Map((spaceMembers.data?.members ?? []).filter((member) => member.userId).map((member) => [member.userId!, member.role]));

  return (
    <div className="panel">
      <h3>Quién puede entrar a este espacio</h3>
      {(team.data?.members ?? []).map((member) => {
        const role = assigned.get(member.userId);
        return (
          <div className="member-row" key={member.userId}>
            <div>
              <div className="member-name">{member.name}</div>
              <div className="member-email">{member.email}</div>
            </div>
            <div className="row-actions">
              <Select
                value={role ?? ''}
                onChange={(next) => (next ? grant.mutate({ userId: member.userId, role: next as 'admin' | 'writer' | 'reader' }) : revoke.mutate(member.userId))}
                options={[
                  { value: '', label: 'Sin acceso' },
                  { value: 'reader', label: 'Lee' },
                  { value: 'writer', label: 'Escribe' },
                  { value: 'admin', label: 'Administra' },
                ]}
              />
            </div>
          </div>
        );
      })}
      <p className="status">Quien administra el espacio de trabajo entra a todos los espacios.</p>
      {error ? <p className="status status-error">{error}</p> : null}
    </div>
  );
}
