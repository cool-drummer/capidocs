(function () {
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-feedback]');
        if (!btn) return;
        e.preventDefault();
        const widget = btn.closest('.feedback');
        const kind = btn.getAttribute('data-feedback');
        const route = widget ? widget.getAttribute('data-route') : (location.hash.slice(1) || 'home');

        if (kind === 'link') {
            const url = location.origin + location.pathname + '#' + route;
            (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
                .then(function () {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copiado';
                    setTimeout(function () { btn.innerHTML = original; }, 1400);
                })
                .catch(function () {});
            return;
        }

        try { localStorage.setItem('capidocs_fb_' + route, kind); } catch (err) { /* ignore */ }
        widget.querySelectorAll('.feedback-btn[data-feedback="up"], .feedback-btn[data-feedback="down"]').forEach(function (b) {
            b.classList.toggle('active', b === btn);
        });
        const q = widget.querySelector('.feedback-q');
        if (q) q.textContent = kind === 'up' ? 'Gracias por tu comentario.' : 'Gracias, lo tendremos en cuenta.';
    });
})();
