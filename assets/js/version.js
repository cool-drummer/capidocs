(function () {
    function currentSpec() {
        try { return localStorage.getItem('capidocs_spec_url') || ''; } catch (e) { return ''; }
    }

    function build(config) {
        const site = config.site_config || {};
        const versions = site.versions;
        if (!Array.isArray(versions) || versions.length < 2) return;

        const content = document.querySelector('.navbar-content');
        const brand = document.querySelector('.navbar-brand');
        if (!content || content.querySelector('.version-select')) return;

        const active = currentSpec();
        const current = versions.find(function (v) { return v.spec === active; }) || versions[0];

        const wrap = document.createElement('div');
        wrap.className = 'version-select';
        wrap.innerHTML =
            '<button class="version-btn" type="button" aria-label="Versión">' +
            '<span class="version-label"></span>' +
            '<i class="fas fa-chevron-down"></i>' +
            '</button>' +
            '<div class="version-menu"></div>';
        wrap.querySelector('.version-label').textContent = current.label;

        const menu = wrap.querySelector('.version-menu');
        versions.forEach(function (v) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'version-item' + (v === current ? ' active' : '');
            item.textContent = v.label;
            item.addEventListener('click', function () {
                try {
                    if (v.url) { window.open(v.url, '_self'); return; }
                    localStorage.setItem('capidocs_spec_url', v.spec || '');
                } catch (e) { /* ignore */ }
                location.reload();
            });
            menu.appendChild(item);
        });

        wrap.querySelector('.version-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            wrap.classList.toggle('open');
        });
        document.addEventListener('click', function () { wrap.classList.remove('open'); });

        if (brand && brand.nextSibling) content.insertBefore(wrap, brand.nextSibling);
        else content.appendChild(wrap);
    }

    function init() {
        if (!window.configLoader) return;
        window.configLoader.load().then(build).catch(function () {});
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
