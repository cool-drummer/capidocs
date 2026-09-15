import { setSpecOverride, activeSpecUrl } from './spec-loader.js';

function buildMenu({ className, buttonClass, label, icon, ariaLabel, items, isActive, onSelect }) {
    const wrap = document.createElement('div');
    wrap.className = `version-select ${className}`.trim();
    wrap.innerHTML = `
        <button class="version-btn ${buttonClass}" type="button" aria-label="${ariaLabel}">
            ${icon ? `<i class="${icon}"></i>` : ''}
            <span class="version-label"></span>
            <i class="fas fa-chevron-down"></i>
        </button>
        <div class="version-menu"></div>`;
    wrap.querySelector('.version-label').textContent = label;
    const menu = wrap.querySelector('.version-menu');
    items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `version-item${isActive(item) ? ' active' : ''}`;
        button.textContent = item.label;
        button.addEventListener('click', () => onSelect(item));
        menu.appendChild(button);
    });
    wrap.querySelector('.version-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        wrap.classList.toggle('open');
    });
    document.addEventListener('click', () => wrap.classList.remove('open'));
    return wrap;
}

function insertAfterBrand(element) {
    const content = document.querySelector('.navbar-content');
    const brand = document.querySelector('.navbar-brand');
    if (!content) return;
    const previous = Array.from(content.querySelectorAll('.version-select')).pop();
    const anchor = previous || brand;
    if (anchor && anchor.nextSibling) content.insertBefore(element, anchor.nextSibling);
    else content.appendChild(element);
}

export function renderVersionSelect(spec, t) {
    const versions = (spec.site_config && spec.site_config.versions) || [];
    if (versions.length < 2 || document.querySelector('.navbar-content .version-select:not(.lang-select)')) return;
    const active = activeSpecUrl('');
    const current = versions.find((version) => version.spec === active) || versions[0];
    insertAfterBrand(buildMenu({
        className: '',
        buttonClass: '',
        label: current.label,
        icon: '',
        ariaLabel: t('version', 'Versión'),
        items: versions,
        isActive: (item) => item === current,
        onSelect: (item) => {
            if (item.url) {
                window.location.assign(item.url);
                return;
            }
            setSpecOverride(item.spec || '');
            location.reload();
        }
    }));
}

export function renderLanguageSelect(spec, t) {
    const site = spec.site_config || {};
    const languages = site.languages || [];
    if (languages.length < 2 || document.querySelector('.navbar-content .lang-select')) return;
    const currentCode = site.lang || languages[0].code;
    const current = languages.find((language) => language.code === currentCode) || languages[0];
    insertAfterBrand(buildMenu({
        className: 'lang-select',
        buttonClass: 'lang-btn',
        label: current.label,
        icon: 'fas fa-globe',
        ariaLabel: t('language', 'Idioma'),
        items: languages,
        isActive: (item) => item.code === current.code,
        onSelect: (item) => {
            if (item.code === current.code) return;
            setSpecOverride(item.spec || '');
            try {
                localStorage.setItem('capidocs_lang', item.code || '');
            } catch {
                console.warn('localStorage unavailable');
            }
            location.reload();
        }
    }));
}
