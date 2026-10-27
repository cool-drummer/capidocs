import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, friendlyError } from '../api';

interface FrameMessage {
  type?: string;
  channel?: string;
  set?: unknown;
  diagram?: unknown;
}

interface ExplorerTarget {
  channel: string;
  set: unknown;
  diagram: string;
}

function newChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function PreviewPanel({ portalId }: { portalId: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const explorerFrame = useRef<HTMLIFrameElement | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [explorer, setExplorer] = useState<ExplorerTarget | null>(null);
  const preview = useQuery({ queryKey: ['preview', portalId], queryFn: () => api.previewPortal(portalId) });

  const specs = preview.data?.specs ?? [];
  const active = specs.find((entry) => entry.locale === locale) ?? specs[0];
  const channel = useMemo(() => newChannel(), [active]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as FrameMessage | null;
      if (event.source !== frame.current?.contentWindow || !data || data.channel !== channel) return;
      if (data.type === 'capidocs:frame-ready') {
        frame.current?.contentWindow?.postMessage({ type: 'capidocs:spec', channel, spec: active.spec }, '*');
      }
      if (data.type === 'capidocs:open-explorer' && data.set) {
        setExplorer({ channel: newChannel(), set: data.set, diagram: typeof data.diagram === 'string' ? data.diagram : '' });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, channel]);

  useEffect(() => {
    if (!explorer) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as FrameMessage | null;
      if (event.source !== explorerFrame.current?.contentWindow || !data || data.channel !== explorer.channel) return;
      if (data.type === 'capidocs:explorer-ready') {
        explorerFrame.current?.contentWindow?.postMessage(
          { type: 'capidocs:diagram-set', channel: explorer.channel, set: explorer.set, diagram: explorer.diagram },
          '*',
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [explorer]);

  if (preview.isLoading) return <div className="placeholder">Compilando la vista previa…</div>;
  if (preview.error) return <div className="placeholder">{friendlyError(preview.error)}</div>;

  return (
    <div className="preview">
      <div className="preview-head">
        <span className="sidebar-label">{explorer ? 'Explorador de diagramas' : 'Vista previa'}</span>
        {explorer ? (
          <button type="button" className="button button-quiet" onClick={() => setExplorer(null)}>
            Volver a la vista previa
          </button>
        ) : null}
        {!explorer && specs.length > 1 ? (
          <div className="locale-switch">
            {specs.map((entry) => (
              <button
                key={entry.locale}
                type="button"
                className={entry.locale === active?.locale ? 'locale-button locale-button-active' : 'locale-button'}
                onClick={() => setLocale(entry.locale)}
              >
                {entry.locale.toUpperCase()}
              </button>
            ))}
          </div>
        ) : null}
        {!explorer ? <span className="status">Así se verá el portal con lo que ya está publicado en los espacios que puedes ver.</span> : null}
      </div>
      <iframe
        key={channel}
        ref={frame}
        className={explorer ? 'preview-frame preview-frame-hidden' : 'preview-frame'}
        title="Vista previa del portal"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={`/api/preview/frame?channel=${channel}`}
      />
      {explorer ? (
        <iframe
          key={explorer.channel}
          ref={explorerFrame}
          className="preview-frame"
          title="Explorador de diagramas"
          sandbox="allow-scripts allow-downloads"
          referrerPolicy="no-referrer"
          src={`/api/preview/explorer?channel=${explorer.channel}`}
        />
      ) : null}
    </div>
  );
}
