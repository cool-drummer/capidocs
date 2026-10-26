import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const PREVIEW_FILES_PATH = '/api/preview/files/';
const CDN = 'https://cdnjs.cloudflare.com';

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
    `script-src 'nonce-${nonce}' ${origin}/site/ ${CDN}`,
    `style-src 'unsafe-inline' ${origin}/site/ ${CDN}`,
    `font-src ${origin}/site/ ${CDN} data:`,
    `img-src ${origin} data: https:`,
    "connect-src 'none'",
    `frame-ancestors ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    'sandbox allow-scripts',
  ].join('; ');
}

export function previewFrame(): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Vista previa</title>
<link rel="stylesheet" href="${CDN}/ajax/libs/font-awesome/6.5.1/css/all.min.css" integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==" crossorigin="anonymous" referrerpolicy="no-referrer">
<link rel="stylesheet" href="/site/assets/css/capidocs.css">
</head>
<body>
<nav class="navbar"><div class="container navbar-content">
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
<footer class="footer"><div class="footer-content"><h3 class="footer-title"></h3><p class="footer-subtitle"></p></div></footer>
<script nonce="${nonce}">window.Prism = window.Prism || {}; window.Prism.manual = true;</script>
<script nonce="${nonce}" src="${CDN}/ajax/libs/prism/1.29.0/components/prism-core.min.js" integrity="sha512-9khQRAUBYEJDCDVP2yw3LRUQvjJ0Pjx0EShmaQjcHa6AXiOv6qHQu9lCAIR8O+/D8FtaCoJ2c0Tf9Xo7hYH01Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script nonce="${nonce}" src="${CDN}/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js" integrity="sha512-SkmBfuA2hqjzEVpmnMt/LINrjop3GKWqsuLSSB3e7iBmYK7JuWw4ldmmxwD9mdm2IRTTi0OxSAfEGvgEi0i2Kw==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script type="module" nonce="${nonce}">
import { createCapidocs } from '/site/assets/js/app.js';
const channel = location.hash.slice(1);
let rendered = false;
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || rendered) return;
  const data = event.data;
  if (!data || data.type !== 'capidocs:spec' || data.channel !== channel) return;
  rendered = true;
  await createCapidocs({ spec: data.spec, assetBase: '/site', searchIndexUrl: '' });
  window.parent.postMessage({ type: 'capidocs:ready', channel }, '*');
});
window.parent.postMessage({ type: 'capidocs:frame-ready', channel }, '*');
</script>
</body>
</html>`;
  return { html, nonce };
}
