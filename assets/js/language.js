(function () {
    function build(config) {
        const site = config.site_config || {};
        const languages = site.languages;
        if (!Array.isArray(languages) || languages.length < 2) return;

        const content = document.querySelector('.navbar-content');
        if (!content || content.querySelector('.lang-select')) return;

        const currentCode = site.lang || languages[0].code;
        const current = languages.find(function (l) { return l.code === currentCode; }) || languages[0];

        const wrap = document.createElement('div');
        wrap.className = 'version-select lang-select';
        wrap.innerHTML =
            '<button class="version-btn lang-btn" type="button" aria-label="Idioma">' +
            '<i class="fas fa-globe"></i>' +
            '<span class="lang-label"></span>' +
            '<i class="fas fa-chevron-down"></i>' +
            '</button>' +
            '<div class="version-menu"></div>';
        wrap.querySelector('.lang-label').textContent = current.label;

        const menu = wrap.querySelector('.version-menu');
        languages.forEach(function (lang) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'version-item lang-item' + (lang.code === current.code ? ' active' : '');
            item.textContent = lang.label;
            item.addEventListener('click', function () {
                if (lang.code === current.code) return;
                try {
                    localStorage.setItem('capidocs_spec_url', lang.spec || '');
                    localStorage.setItem('capidocs_lang', lang.code || '');
                } catch (e) { /* ignore */ }
                location.reload();
            });
            menu.appendChild(item);
        });

        wrap.querySelector('.lang-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            wrap.classList.toggle('open');
        });
        document.addEventListener('click', function () { wrap.classList.remove('open'); });

        const versionSelect = content.querySelector('.version-select:not(.lang-select)');
        const brand = document.querySelector('.navbar-brand');
        if (versionSelect && versionSelect.nextSibling) content.insertBefore(wrap, versionSelect.nextSibling);
        else if (brand && brand.nextSibling) content.insertBefore(wrap, brand.nextSibling);
        else content.appendChild(wrap);
    }

    function init() {
        if (!window.configLoader) return;
        window.configLoader.load().then(build).catch(function () {});
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
