import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PREVIEW_FILES_PATH = '/api/preview/files/';

export interface UrlSigner {
  sign: (key: string, now?: number) => string;
  verify: (key: string, expires: number, signature: string, now?: number) => boolean;
}

export function createUrlSigner(secret: Buffer, ttlSeconds: number): UrlSigner {
  const mac = (key: string, expires: number) => createHmac('sha256', secret).update(`${key}:${expires}`).digest('base64url');
  return {
    sign(key, now = Date.now()) {
      const expires = Math.floor(now / 1000) + ttlSeconds;
      return `${PREVIEW_FILES_PATH}${key}?expires=${expires}&signature=${mac(key, expires)}`;
    },
    verify(key, expires, signature, now = Date.now()) {
      const seconds = Math.floor(now / 1000);
      if (!Number.isInteger(expires) || expires < seconds || expires > seconds + ttlSeconds) return false;
      const expected = Buffer.from(mac(key, expires));
      const presented = Buffer.from(signature);
      return expected.length === presented.length && timingSafeEqual(expected, presented);
    },
  };
}

export function previewFrameCsp(origin: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${origin}/site/`,
    `style-src 'unsafe-inline' ${origin}/site/`,
    `font-src ${origin}/site/ data:`,
    `img-src ${origin} data: https:`,
    "connect-src 'none'",
    `frame-ancestors ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    'sandbox allow-scripts',
  ].join('; ');
}

export const SITE_BODY = `<nav class="navbar"><div class="container navbar-content">
  <a href="#home" class="navbar-brand"><i class="fas fa-book navbar-brand-icon"></i><span></span><span class="brand-badge"></span></a>
  <div class="navbar-tabs" id="navbar-tabs"></div>
  <div class="navbar-nav" id="navbar-nav"><button class="theme-toggle" id="theme-toggle" aria-label="Cambiar tema"><i class="fas fa-moon" id="theme-icon"></i></button></div>
  <button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="Menú"><i class="fas fa-bars"></i></button>
</div></nav>
<div class="main-layout">
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <aside class="sidebar" id="sidebar"></aside>
  <main class="main-content" id="main-content"></main>
  <aside class="toc-sidebar" id="toc-sidebar"><div class="toc-header"><h6>En esta página</h6></div><nav class="toc-nav"><ul class="toc-list" id="toc-list"></ul></nav></aside>
</div>
<footer class="footer"><div class="footer-content"><h3 class="footer-title"></h3><p class="footer-subtitle"></p></div></footer>`;

export function previewFrame(base: string): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Vista previa</title>
<link rel="stylesheet" href="${base}/assets/vendor/fontawesome/css/all.min.css">
<link rel="stylesheet" href="${base}/assets/css/capidocs.css">
</head>
<body>
${SITE_BODY}
<script nonce="${nonce}">window.Prism = window.Prism || {}; window.Prism.manual = true;</script>
<script nonce="${nonce}" src="${base}/assets/vendor/prism/prism-core.min.js"></script>
<script nonce="${nonce}" src="${base}/assets/vendor/prism/plugins/autoloader/prism-autoloader.min.js"></script>
<script type="module" nonce="${nonce}">
import { createCapidocs } from '${base}/assets/js/app.js';
const channel = new URLSearchParams(location.search).get('channel') || '';
let rendered = false;
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || rendered) return;
  const data = event.data;
  if (!data || data.type !== 'capidocs:spec' || data.channel !== channel) return;
  rendered = true;
  await createCapidocs({
    spec: data.spec,
    assetBase: '${base}',
    searchIndexUrl: '',
    openExplorer: (target) => window.parent.postMessage({ type: 'capidocs:open-explorer', channel, set: target.set, diagram: target.diagram }, '*'),
  });
  window.parent.postMessage({ type: 'capidocs:ready', channel }, '*');
});
window.parent.postMessage({ type: 'capidocs:frame-ready', channel }, '*');
</script>
</body>
</html>`;
  return { html, nonce };
}

export function previewExplorerCsp(origin: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${origin}/site/`,
    `style-src 'unsafe-inline' ${origin}/site/`,
    `font-src ${origin}/site/ data:`,
    "img-src data: blob:",
    `connect-src ${origin}/site/`,
    `frame-ancestors ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    'sandbox allow-scripts allow-downloads',
  ].join('; ');
}

export function previewExplorer(base: string): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Explorador de diagramas</title>
<link rel="stylesheet" href="${base}/assets/css/diagram-viewer.css" data-dg-styles>
<link rel="stylesheet" href="${base}/assets/css/diagrams.css">
</head>
<body>
<div id="app" class="dx-app"><p class="dx-boot">Cargando diagramas…</p></div>
<script type="module" nonce="${nonce}">
import { validateDiagramSet } from '${base}/assets/js/diagram/model.js';
import { mountExplorer } from '${base}/assets/js/diagram/explorer.js';
import { svgToRaster } from '${base}/assets/js/diagram/export/raster.js';
import { buildPdf } from '${base}/assets/js/diagram/export/pdf.js';
import { downloadBlob } from '${base}/assets/js/diagram/export/download.js';
const channel = new URLSearchParams(location.search).get('channel') || '';
let mounted = false;
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || mounted) return;
  const data = event.data;
  if (!data || data.type !== 'capidocs:diagram-set' || data.channel !== channel) return;
  mounted = true;
  const root = document.getElementById('app');
  const result = validateDiagramSet(data.set);
  if (!result.ok) {
    root.querySelector('.dx-boot').textContent = 'No se pudo abrir el diagrama.';
    return;
  }
  document.documentElement.lang = result.set.lang || 'es';
  if (typeof data.diagram === 'string' && data.diagram) location.hash = '#/d/' + encodeURIComponent(data.diagram);
  root.textContent = '';
  mountExplorer(root, {
    set: result.set,
    source: 'embedded',
    storages: null,
    features: { import: false, export: ['svg', 'png', 'jpg', 'pdf', 'json'], storage: false },
    services: { svgToRaster, buildPdf, downloadBlob },
  });
});
window.parent.postMessage({ type: 'capidocs:explorer-ready', channel }, '*');
</script>
</body>
</html>`;
  return { html, nonce };
}
