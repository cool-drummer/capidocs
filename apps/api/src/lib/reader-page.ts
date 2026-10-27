import { randomBytes } from 'node:crypto';
import { SITE_BODY } from './preview.js';

export const READER_EXPLORER_KEY = 'capidocs.reader.explorer';

export function readerCsp(origin: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${origin}/site/`,
    `style-src 'unsafe-inline' ${origin}/site/`,
    `font-src ${origin}/site/ data:`,
    `img-src ${origin} data: blob: https:`,
    `connect-src 'self' ${origin}/site/`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function readerPage(base: string, slug: string): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Documentación</title>
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
const slug = ${JSON.stringify(slug)};
const api = '/api/read/' + encodeURIComponent(slug);
const GENERIC = 'Algo salió mal, inténtalo de nuevo en un momento.';

async function call(method, path, body) {
  const response = await fetch(api + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  return { status: response.status, data };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function gate(portalName) {
  document.getElementById('docs-gate')?.remove();
  const overlay = element('div');
  overlay.id = 'docs-gate';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const card = element('div', 'docs-gate-card');
  card.append(element('div', 'docs-gate-brand docs-gate-brand-text', portalName || 'Documentación'));
  const title = element('h1', '', 'Entra con tu correo');
  const sub = element('p', 'docs-gate-sub', 'Escribe el correo que te autorizaron. Te enviaremos un código para entrar.');
  const form = element('form', 'docs-gate-form');
  form.noValidate = true;
  const label = element('label', '', 'Correo electrónico');
  label.htmlFor = 'reader-field';
  const input = element('input');
  input.id = 'reader-field';
  input.type = 'email';
  input.autocomplete = 'email';
  input.placeholder = 'tu@correo.com';
  const error = element('div', 'docs-gate-error');
  error.hidden = true;
  const button = element('button', '', 'Enviarme un código');
  button.type = 'submit';
  const back = element('button', 'docs-gate-link', 'Usar otro correo');
  back.type = 'button';
  back.hidden = true;
  form.append(label, input, error, button, back);
  card.append(title, sub, form);
  overlay.append(card);
  document.body.append(overlay);
  document.documentElement.classList.add('docs-gate-locked');
  input.focus();

  let email = '';
  const fail = (message) => { error.textContent = message || GENERIC; error.hidden = false; };
  const askEmail = () => {
    email = '';
    title.textContent = 'Entra con tu correo';
    sub.textContent = 'Escribe el correo que te autorizaron. Te enviaremos un código para entrar.';
    label.textContent = 'Correo electrónico';
    input.type = 'email'; input.autocomplete = 'email'; input.inputMode = 'email'; input.placeholder = 'tu@correo.com'; input.value = '';
    button.textContent = 'Enviarme un código';
    back.hidden = true; error.hidden = true; input.focus();
  };
  back.addEventListener('click', askEmail);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const value = input.value.trim();
    if (!value) return fail(email ? 'Escribe el código de 6 dígitos.' : 'Escribe tu correo electrónico.');
    button.disabled = true;
    try {
      if (!email) {
        const result = await call('POST', '/code', { email: value });
        if (result.status !== 202) return fail(result.data.message);
        email = value.toLowerCase();
        title.textContent = 'Revisa tu correo';
        sub.textContent = 'Si ' + email + ' tiene acceso, te llegará un código de 6 dígitos en unos segundos. Vence en 10 minutos.';
        label.textContent = 'Código';
        input.type = 'text'; input.autocomplete = 'one-time-code'; input.inputMode = 'numeric'; input.placeholder = '123456'; input.value = '';
        button.textContent = 'Entrar';
        back.hidden = false; input.focus();
        return;
      }
      const result = await call('POST', '/verify', { email, code: value.replace(/\\s+/g, '') });
      if (result.status !== 200) return fail(result.data.message);
      overlay.remove();
      document.documentElement.classList.remove('docs-gate-locked');
      await start();
    } catch {
      fail();
    } finally {
      button.disabled = false;
    }
  });
}

function signOutButton() {
  const nav = document.getElementById('navbar-nav');
  if (!nav || document.getElementById('reader-sign-out')) return;
  const button = element('button', 'theme-toggle', '');
  button.id = 'reader-sign-out';
  button.type = 'button';
  button.setAttribute('aria-label', 'Salir');
  button.title = 'Salir';
  const icon = element('i', 'fas fa-right-from-bracket');
  button.append(icon);
  button.addEventListener('click', async () => {
    await call('POST', '/logout').catch(() => undefined);
    location.reload();
  });
  nav.append(button);
}

async function start() {
  const { status, data } = await call('GET', '/spec');
  if (status === 401) return gate(data.portal);
  if (status !== 200) {
    const main = document.getElementById('main-content');
    if (main) main.textContent = status === 404 ? 'No encontramos esta documentación.' : GENERIC;
    return;
  }
  document.title = data.spec.site_config?.name || 'Documentación';
  await createCapidocs({
    spec: data.spec,
    assetBase: ${JSON.stringify(base)},
    searchIndexUrl: '',
    openExplorer: (target) => {
      try {
        sessionStorage.setItem(${JSON.stringify(READER_EXPLORER_KEY)}, JSON.stringify({ set: target.set, diagram: target.diagram }));
      } catch {
        return;
      }
      location.href = '/read/' + encodeURIComponent(slug) + '/explorer#/d/' + encodeURIComponent(target.diagram || '');
    },
  });
  signOutButton();
}

start().catch(() => {
  const main = document.getElementById('main-content');
  if (main) main.textContent = GENERIC;
});
</script>
</body>
</html>`;
  return { html, nonce };
}

export function readerExplorerPage(base: string, slug: string): { html: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
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
const root = document.getElementById('app');
const back = '/read/' + encodeURIComponent(${JSON.stringify(slug)});
let stored = null;
try { stored = JSON.parse(sessionStorage.getItem(${JSON.stringify(READER_EXPLORER_KEY)}) || 'null'); } catch { stored = null; }
const result = stored ? validateDiagramSet(stored.set) : { ok: false };
if (!result.ok) {
  root.textContent = '';
  const message = document.createElement('p');
  message.className = 'dx-boot';
  message.textContent = 'Abre el explorador desde un diagrama de la documentación. ';
  const link = document.createElement('a');
  link.href = back;
  link.textContent = 'Volver a la documentación';
  message.append(link);
  root.append(message);
} else {
  document.documentElement.lang = result.set.lang || 'es';
  root.textContent = '';
  mountExplorer(root, {
    set: result.set,
    source: 'embedded',
    storages: null,
    features: { import: false, export: ['svg', 'png', 'jpg', 'pdf', 'json'], storage: false },
    services: { svgToRaster, buildPdf, downloadBlob },
  });
}
</script>
</body>
</html>`;
  return { html, nonce };
}
