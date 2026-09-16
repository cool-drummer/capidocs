import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ApiError} from '../api';
import { api, type Portal, type Space, type TreeNode } from '../api';
import { PageEditor } from './page-editor';
import { Field, Select, TextInput } from '../components/fields';

const AUDIENCE_LABEL: Record<Space['audience'], string> = {
  public: 'Público',
  customers: 'Clientes',
  internal: 'Empleados',
};

function TreeItem({
  node,
  depth,
  selectedId,
  onSelect,
  onMove,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, parentPageId: string | null, index: number) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div
        className={node.id === selectedId ? 'tree-item tree-item-active' : 'tree-item'}
        style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
      >
        <button type="button" className="tree-link" onClick={() => onSelect(node.id)}>
          <span className="tree-title">{node.title || 'Sin título'}</span>
          {node.kind === 'hero' ? <span className="chip chip-small">portada</span> : null}
          {node.hasDraft ? <span className="dot" aria-label="Con cambios sin publicar" /> : null}
        </button>
        <div className="tree-actions">
          <button type="button" className="icon-button" aria-label="Subir" onClick={() => onMove(node.id, node.parentPageId, 0)}>
            ↑
          </button>
          <button type="button" className="icon-button icon-button-danger" aria-label="Eliminar" onClick={() => onDelete(node.id)}>
            ✕
          </button>
        </div>
      </div>
      {node.children.map((child) => (
        <TreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onMove={onMove}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function NewSpaceForm({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const portals = useQuery({ queryKey: ['portals'], queryFn: api.portals });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [audience, setAudience] = useState<Space['audience']>('internal');
  const [portalId, setPortalId] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createSpace({ name, slug, audience, portalId: audience === 'internal' ? null : portalId || null }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['spaces'] });
      onDone();
    },
    onError: (err: ApiError) => setError(err.message),
  });

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        create.mutate();
      }}
    >
      <h3>Nuevo espacio</h3>
      <Field label="Nombre">
        <TextInput
          value={name}
          onChange={(value) => {
            setName(value);
            setSlug(value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
          }}
        />
      </Field>
      <Field label="Identificador" hint="Solo minúsculas, números y guiones">
        <TextInput value={slug} onChange={setSlug} mono />
      </Field>
      <Field label="Audiencia" hint="Define quién puede leerlo y dónde se sirve">
        <Select
          value={audience}
          onChange={(value) => setAudience(value as Space['audience'])}
          options={[
            { value: 'internal', label: 'Empleados' },
            { value: 'customers', label: 'Clientes' },
            { value: 'public', label: 'Público' },
          ]}
        />
      </Field>
      {audience !== 'internal' ? (
        <Field label="Portal" hint="Un espacio público o de clientes se publica en un portal">
          <Select
            value={portalId}
            onChange={setPortalId}
            options={[{ value: '', label: 'Elige un portal' }, ...(portals.data?.portals ?? []).map((portal) => ({ value: portal.id, label: portal.name }))]}
          />
        </Field>
      ) : null}
      {error ? <p className="status status-error">{error}</p> : null}
      <div className="panel-actions">
        <button type="button" className="button button-quiet" onClick={onDone}>
          Cancelar
        </button>
        <button type="submit" className="button button-primary" disabled={create.isPending}>
          Crear espacio
        </button>
      </div>
    </form>
  );
}

function PortalRow({ portal, onPublish, publishing }: { portal: Portal; onPublish: () => void; publishing: boolean }) {
  const client = useQueryClient();
  const target = (portal.deployTarget ?? {}) as { kind?: string; path?: string };
  const [path, setPath] = useState(target.path ?? '');
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => api.updatePortal(portal.id, { deployTarget: path ? { kind: 'directory', path } : {} }),
    onSuccess: () => {
      setOpen(false);
      void client.invalidateQueries({ queryKey: ['portals'] });
    },
  });

  return (
    <div className="portal-card">
      <div className="portal-row">
        <div>
          <div className="portal-name">{portal.name}</div>
          <div className="portal-url">{portal.siteUrl ?? 'Sin dominio'}</div>
        </div>
        <div className="row-actions">
          <button type="button" className="button button-quiet" onClick={() => setOpen((value) => !value)}>
            Destino
          </button>
          <button type="button" className="button" disabled={publishing} onClick={onPublish}>
            Publicar
          </button>
        </div>
      </div>
      {open ? (
        <div className="portal-target">
          <Field label="Carpeta de publicación" hint="Ruta donde se escribe el sitio compilado">
            <TextInput value={path} onChange={setPath} mono placeholder="/var/www/docs" />
          </Field>
          <button type="button" className="button button-quiet" disabled={save.isPending} onClick={() => save.mutate()}>
            Guardar destino
          </button>
        </div>
      ) : null}
      {!target.path ? <p className="status">Sin destino: al publicar solo se compila.</p> : null}
    </div>
  );
}

function PortalsPanel() {
  const client = useQueryClient();
  const portals = useQuery({ queryKey: ['portals'], queryFn: api.portals });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [message, setMessage] = useState('');

  const create = useMutation({
    mutationFn: () => api.createPortal({ name, slug, ...(siteUrl ? { siteUrl } : {}) }),
    onSuccess: () => {
      setName('');
      setSlug('');
      setSiteUrl('');
      setMessage('Portal creado.');
      void client.invalidateQueries({ queryKey: ['portals'] });
    },
    onError: (error: ApiError) => setMessage(error.message),
  });

  const publish = useMutation({
    mutationFn: (portalId: string) => api.publishPortal(portalId),
    onSuccess: (result) => {
      setMessage(
        result.status === 'unchanged'
          ? 'Sin cambios desde la última publicación.'
          : `Publicado: ${result.routes} páginas. ${result.output.detail ?? ''}`.trim(),
      );
    },
    onError: (error: ApiError) => setMessage(error.message),
  });

  return (
    <div className="panel">
      <h3>Portales</h3>
      {(portals.data?.portals ?? []).map((portal) => (
        <PortalRow key={portal.id} portal={portal} onPublish={() => publish.mutate(portal.id)} publishing={publish.isPending} />
      ))}
      <form
        className="portal-form"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage('');
          create.mutate();
        }}
      >
        <Field label="Nombre del portal">
          <TextInput
            value={name}
            onChange={(value) => {
              setName(value);
              setSlug(value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
            }}
          />
        </Field>
        <Field label="Dominio" hint="Opcional, para el sitemap y los enlaces">
          <TextInput value={siteUrl} onChange={setSiteUrl} mono placeholder="https://docs.ejemplo.com" />
        </Field>
        <button type="submit" className="button button-quiet" disabled={create.isPending || !name}>
          Crear portal
        </button>
      </form>
      {message ? <p className="status">{message}</p> : null}
    </div>
  );
}

export function WorkspaceScreen({ onLogout }: { onLogout: () => void }) {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: api.spaces });
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'space' | 'portals'>('none');

  const activeSpace = spaces.data?.spaces.find((space) => space.id === spaceId) ?? spaces.data?.spaces[0] ?? null;
  const activeLocale = locale ?? me.data?.workspace.defaultLocale ?? 'es';

  const tree = useQuery({
    queryKey: ['tree', activeSpace?.id, activeLocale],
    queryFn: () => api.tree(activeSpace!.id, activeLocale),
    enabled: !!activeSpace,
  });

  const createPage = useMutation({
    mutationFn: (kind: 'page' | 'hero') =>
      api.createPage(activeSpace!.id, { title: kind === 'hero' ? 'Portada' : 'Nueva página', kind, locale: activeLocale }),
    onSuccess: (result) => {
      setPageId(result.page.id);
      void client.invalidateQueries({ queryKey: ['tree'] });
    },
  });

  const move = useMutation({
    mutationFn: ({ id, parentPageId, index }: { id: string; parentPageId: string | null; index: number }) =>
      api.movePage(id, parentPageId, index),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tree'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePage(id),
    onSuccess: () => {
      setPageId(null);
      void client.invalidateQueries({ queryKey: ['tree'] });
    },
  });

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">{me.data?.workspace.name ?? 'Studio'}</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="button button-quiet" onClick={() => setPanel(panel === 'portals' ? 'none' : 'portals')}>
            Portales
          </button>
          <span className="who">{me.data?.user.name}</span>
          <button type="button" className="button button-quiet" onClick={onLogout}>
            Salir
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span className="sidebar-label">Espacios</span>
            <button type="button" className="icon-button" aria-label="Nuevo espacio" onClick={() => setPanel('space')}>
              +
            </button>
          </div>
          {(spaces.data?.spaces ?? []).map((space) => (
            <button
              key={space.id}
              type="button"
              className={space.id === activeSpace?.id ? 'space-item space-item-active' : 'space-item'}
              onClick={() => {
                setSpaceId(space.id);
                setPageId(null);
              }}
            >
              <span>{space.name}</span>
              <span className="chip chip-small">{AUDIENCE_LABEL[space.audience]}</span>
            </button>
          ))}
          {spaces.data && !spaces.data.spaces.length ? <p className="placeholder">Aún no tienes espacios.</p> : null}

          {activeSpace ? (
            <>
              <div className="sidebar-head sidebar-head-spaced">
                <span className="sidebar-label">Páginas</span>
                <div className="tree-actions">
                  <button type="button" className="icon-button" aria-label="Nueva portada" onClick={() => createPage.mutate('hero')}>
                    ★
                  </button>
                  <button type="button" className="icon-button" aria-label="Nueva página" onClick={() => createPage.mutate('page')}>
                    +
                  </button>
                </div>
              </div>
              {(tree.data?.tree ?? []).map((node) => (
                <TreeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={pageId}
                  onSelect={setPageId}
                  onMove={(id, parentPageId, index) => move.mutate({ id, parentPageId, index })}
                  onDelete={(id) => remove.mutate(id)}
                />
              ))}
              {tree.data && !tree.data.tree.length ? <p className="placeholder">Este espacio no tiene páginas.</p> : null}
            </>
          ) : null}
        </aside>

        <main className="main">
          {panel === 'space' ? <NewSpaceForm onDone={() => setPanel('none')} /> : null}
          {panel === 'portals' ? <PortalsPanel /> : null}
          {panel === 'none' && pageId ? <PageEditor pageId={pageId} locale={activeLocale} onLocale={setLocale} /> : null}
          {panel === 'none' && !pageId ? (
            <div className="placeholder placeholder-center">
              <p>Elige una página en la izquierda o crea una nueva.</p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
