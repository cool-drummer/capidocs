import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError } from '../api';
import { api } from '../api';

function newChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function PreviewPanel({ portalId }: { portalId: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ['preview', portalId], queryFn: () => api.previewPortal(portalId) });

  const specs = preview.data?.specs ?? [];
  const active = specs.find((entry) => entry.locale === locale) ?? specs[0];
  const channel = useMemo(() => newChannel(), [active]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; channel?: string } | null;
      if (event.source !== frame.current?.contentWindow || !data || data.channel !== channel) return;
      if (data.type === 'capidocs:frame-ready') {
        frame.current?.contentWindow?.postMessage({ type: 'capidocs:spec', channel, spec: active.spec }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, channel]);

  if (preview.isLoading) return <div className="placeholder">Compilando la vista previa…</div>;
  if (preview.error) return <div className="placeholder">{(preview.error as ApiError).message}</div>;

  return (
    <div className="preview">
      <div className="preview-head">
        <span className="sidebar-label">Vista previa</span>
        {specs.length > 1 ? (
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
        <span className="status">Así se verá el portal con lo que ya está publicado en los espacios que puedes ver.</span>
      </div>
      <iframe
        key={channel}
        ref={frame}
        className="preview-frame"
        title="Vista previa del portal"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={`/api/preview/frame#${channel}`}
      />
    </div>
  );
}
