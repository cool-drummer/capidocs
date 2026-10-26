import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '../api';
import { api } from '../api';

const FRAME_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==" crossorigin="anonymous" referrerpolicy="no-referrer">
<link rel="stylesheet" href="SITE_BASE/assets/css/capidocs.css">
</head>
<body>
<nav class="navbar"><div class="container navbar-content">
  <a href="#home" class="navbar-brand"><i class="fas fa-book navbar-brand-icon"></i><span></span><span class="brand-badge"></span></a>
  <div class="navbar-tabs" id="navbar-tabs"></div>
  <div class="navbar-nav" id="navbar-nav"><button class="theme-toggle" id="theme-toggle" aria-label="Cambiar tema"><i class="fas fa-moon" id="theme-icon"></i></button></div>
  <button class="mobile-menu-toggle" id="mobile-menu-toggle"><i class="fas fa-bars"></i></button>
</div></nav>
<div class="main-layout">
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <aside class="sidebar" id="sidebar"></aside>
  <main class="main-content" id="main-content"></main>
  <aside class="toc-sidebar" id="toc-sidebar"><div class="toc-header"><h6></h6></div><nav class="toc-nav"><ul class="toc-list" id="toc-list"></ul></nav></aside>
</div>
<footer class="footer"></footer>
<script>window.Prism = window.Prism || {}; window.Prism.manual = true;</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script type="module">
import { createCapidocs } from 'SITE_BASE/assets/js/app.js';
window.addEventListener('message', async (event) => {
  if (!event.data || event.data.type !== 'capidocs:spec') return;
  document.getElementById('main-content').innerHTML = '';
  document.getElementById('sidebar').innerHTML = '';
  await createCapidocs({ spec: event.data.spec, assetBase: 'SITE_BASE', searchIndexUrl: '' });
  parent.postMessage({ type: 'capidocs:ready' }, '*');
});
parent.postMessage({ type: 'capidocs:frame-ready' }, '*');
</script>
</body>
</html>`;

export function PreviewPanel({ portalId, siteBase = '/site' }: { portalId: string; siteBase?: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const preview = useQuery({ queryKey: ['preview', portalId], queryFn: () => api.previewPortal(portalId) });

  const specs = preview.data?.specs ?? [];
  const active = specs.find((entry) => entry.locale === locale) ?? specs[0];

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'capidocs:frame-ready') setFrameReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!frameReady || !active) return;
    frame.current?.contentWindow?.postMessage({ type: 'capidocs:spec', spec: active.spec }, '*');
  }, [frameReady, active]);

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
        <span className="status">Así se verá el portal con lo que ya está publicado.</span>
      </div>
      <iframe
        ref={frame}
        className="preview-frame"
        title="Vista previa del portal"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={FRAME_HTML.replaceAll('SITE_BASE', siteBase)}
      />
    </div>
  );
}
