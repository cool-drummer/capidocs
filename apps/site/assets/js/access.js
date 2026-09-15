import { escapeAttr, escapeHtml } from './escape.js';

const DAY = 86400000;

function storageKey(access, site) {
    return `capidocs_access_${String(access.brand || site.brand || 'site').toLowerCase()}`;
}

function hasValidPass(key) {
    try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        return !!(saved && saved.exp > Date.now());
    } catch {
        return false;
    }
}

function savePass(key, days) {
    try {
        localStorage.setItem(key, JSON.stringify({ exp: Date.now() + days * DAY }));
    } catch {
        return;
    }
}

function renderGate({ access, site, t, resolveAsset, onPass }) {
    const overlay = document.createElement('div');
    overlay.id = 'docs-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const logos = (site.use_logos && site.logos) || {};
    const brandHtml = logos.navbar_light || logos.navbar_dark
        ? `<div class="docs-gate-brand">
                ${logos.navbar_light ? `<img class="docs-gate-logo-light" src="${escapeAttr(resolveAsset(logos.navbar_light))}" alt="${escapeAttr(site.brand || '')}">` : ''}
                ${logos.navbar_dark ? `<img class="docs-gate-logo-dark" src="${escapeAttr(resolveAsset(logos.navbar_dark))}" alt="${escapeAttr(site.brand || '')}">` : ''}
           </div>`
        : `<div class="docs-gate-brand docs-gate-brand-text">${escapeHtml(site.brand || site.name || '')}</div>`;
    overlay.innerHTML = `
        <div class="docs-gate-card">
            ${brandHtml}
            <h1>${escapeHtml(t('gate_title', 'Documentación para clientes'))}</h1>
            <p class="docs-gate-sub">${escapeHtml(t('gate_subtitle', 'Ingresa el correo con el que estás registrado en la plataforma para continuar.'))}</p>
            <form class="docs-gate-form" novalidate>
                <label for="docs-gate-email">${escapeHtml(t('gate_email_label', 'Correo electrónico'))}</label>
                <input id="docs-gate-email" type="email" autocomplete="email" placeholder="${escapeAttr(t('gate_email_placeholder', 'tu@correo.com'))}" required>
                <div class="docs-gate-error" hidden></div>
                <button type="submit">${escapeHtml(t('gate_submit', 'Verificar acceso'))}</button>
            </form>
            ${access.contact ? `<p class="docs-gate-foot">${escapeHtml(t('gate_contact', '¿Aún no tienes acceso? Escríbenos a'))} ${escapeHtml(access.contact)}</p>` : ''}
        </div>`;

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    const errorBox = overlay.querySelector('.docs-gate-error');
    const button = overlay.querySelector('button');
    const idleLabel = button.textContent;
    const genericError = t('gate_error', 'Algo salió mal, inténtalo de nuevo en un momento');

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = false;
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.hidden = true;
        const email = (input.value || '').trim();
        if (!email) {
            showError(t('gate_email_required', 'Ingresa tu correo electrónico'));
            return;
        }
        button.disabled = true;
        button.textContent = t('gate_checking', 'Verificando…');
        try {
            const response = await fetch(access.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            if (data && data.status === 'success') {
                onPass();
                overlay.remove();
                document.documentElement.classList.remove('docs-gate-locked');
                return;
            }
            showError(genericError);
        } catch (error) {
            console.error('Access check failed:', error);
            showError(genericError);
        }
        button.disabled = false;
        button.textContent = idleLabel;
    });

    document.body.appendChild(overlay);
    document.documentElement.classList.add('docs-gate-locked');
    input.focus();
}

export function initAccess({ spec, t, resolveAsset }) {
    const site = spec.site_config || {};
    const access = site.access;
    if (!access || access.mode === 'open') return;

    if (access.mode === 'accounts') {
        const returnTo = encodeURIComponent(window.location.href);
        window.location.replace(`${access.portal_url}${access.portal_url.includes('?') ? '&' : '?'}return_to=${returnTo}`);
        return;
    }

    const key = storageKey(access, site);
    if (hasValidPass(key)) return;
    renderGate({ access, site, t, resolveAsset, onPass: () => savePass(key, access.days || 7) });
}
