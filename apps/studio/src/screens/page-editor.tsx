import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError } from '../api';
import { api } from '../api';
import { emptySection, type Section } from '../blocks';
import { SectionList } from '../components/section-editor';
import { Field, TextArea, TextInput } from '../components/fields';

interface HeroDocument {
  version: 1;
  hero: { title: string; subtitle?: string; description?: string; stats?: { number: string; label: string }[] };
  features?: { title?: string; subtitle?: string; items: { icon?: string; title: string; description?: string }[] };
}

function HeroEditor({ document, onChange }: { document: HeroDocument; onChange: (value: HeroDocument) => void }) {
  const hero = document.hero;
  const stats = hero.stats ?? [];
  return (
    <div className="section-card">
      <div className="grid-1">
        <Field label="Subtítulo">
          <TextInput value={hero.subtitle ?? ''} onChange={(subtitle) => onChange({ ...document, hero: { ...hero, subtitle } })} />
        </Field>
        <Field label="Descripción">
          <TextArea value={hero.description ?? ''} onChange={(description) => onChange({ ...document, hero: { ...hero, description } })} rows={2} />
        </Field>
      </div>
      <div className="block">
        <div className="block-head">
          <span className="block-name">Cifras</span>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onChange({ ...document, hero: { ...hero, stats: [...stats, { number: '', label: '' }] } })}
          >
            Agregar cifra
          </button>
        </div>
        {stats.map((stat, index) => (
          <div className="grid-2" key={index}>
            <TextInput
              value={stat.number}
              onChange={(number) =>
                onChange({ ...document, hero: { ...hero, stats: stats.map((item, i) => (i === index ? { ...item, number } : item)) } })
              }
            />
            <TextInput
              value={stat.label}
              onChange={(label) =>
                onChange({ ...document, hero: { ...hero, stats: stats.map((item, i) => (i === index ? { ...item, label } : item)) } })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageEditor({ pageId, locale, onLocale }: { pageId: string; locale: string; onLocale: (locale: string) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['page', pageId, locale], queryFn: () => api.page(pageId, locale) });
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [hero, setHero] = useState<HeroDocument | null>(null);
  const [status, setStatus] = useState<string>('');
  const loadedFor = useRef<string>('');

  const page = query.data?.page;
  const isHero = page?.kind === 'hero';

  useEffect(() => {
    if (!query.data) return;
    const key = `${pageId}:${locale}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const content = query.data.content;
    setTitle(content?.title ?? '');
    const document = (content?.content ?? {}) as Record<string, unknown>;
    if (query.data.page.kind === 'hero') {
      setHero({ version: 1, hero: { title: content?.title ?? '' }, ...(document as object) } as HeroDocument);
      setSections([]);
    } else {
      setHero(null);
      setSections(Array.isArray(document.sections) ? (document.sections as Section[]) : []);
    }
    setStatus('');
  }, [query.data, pageId, locale]);

  const document = useMemo(
    () =>
      isHero && hero
        ? { ...hero, version: 1 as const, hero: { ...hero.hero, title } }
        : { version: 1 as const, sections },
    [isHero, hero, sections, title],
  );

  const save = useMutation({
    mutationFn: () => api.saveContent(pageId, locale, title, document),
    onSuccess: () => {
      setStatus('Guardado');
      void client.invalidateQueries({ queryKey: ['tree'] });
    },
    onError: (error: ApiError) => setStatus(error.message),
  });

  const publish = useMutation({
    mutationFn: async () => {
      await api.saveContent(pageId, locale, title, document);
      return api.publishPage(pageId, locale);
    },
    onSuccess: (result) => {
      setStatus(`Publicada la versión ${result.version.version}`);
      void client.invalidateQueries({ queryKey: ['tree'] });
    },
    onError: (error: ApiError) => setStatus(error.message),
  });

  if (query.isLoading) return <div className="placeholder">Cargando…</div>;
  if (query.error) return <div className="placeholder">{(query.error as ApiError).message}</div>;
  if (!query.data) return null;

  const canEdit = query.data.canEdit;

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <TextInput value={title} onChange={setTitle} placeholder={isHero ? 'Título de la portada' : 'Título de la página'} />
          <div className="editor-meta">
            <span className="chip">{isHero ? 'Portada' : 'Página'}</span>
            {page?.publishedAt ? <span className="chip chip-ok">Publicada</span> : <span className="chip chip-draft">Borrador</span>}
          </div>
        </div>
        <div className="editor-actions">
          {query.data.locales.length > 1 ? (
            <div className="locale-switch">
              {query.data.locales.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={code === locale ? 'locale-button locale-button-active' : 'locale-button'}
                  onClick={() => onLocale(code)}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="button" disabled={!canEdit || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="button button-primary" disabled={!canEdit || publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </header>

      {status ? <p className="status">{status}</p> : null}
      {!canEdit ? <p className="status">Solo puedes leer esta página.</p> : null}

      {isHero && hero ? (
        <HeroEditor document={hero} onChange={setHero} />
      ) : (
        <>
          <SectionList sections={sections} onChange={setSections} />
          <button type="button" className="button button-quiet" onClick={() => setSections([...sections, emptySection()])}>
            Agregar sección
          </button>
        </>
      )}
    </div>
  );
}
