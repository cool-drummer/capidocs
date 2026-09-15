export function bindFeedback({ t }) {
    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-feedback]');
        if (!button) return;
        event.preventDefault();
        const widget = button.closest('.feedback');
        const kind = button.getAttribute('data-feedback');
        const route = widget ? widget.getAttribute('data-route') : (location.hash.slice(1) || 'home');

        if (kind === 'link') {
            const url = `${location.origin}${location.pathname}#${route}`;
            (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('clipboard')))
                .then(() => {
                    const original = button.innerHTML;
                    button.innerHTML = `<i class="fas fa-check"></i> ${t('copied', 'Copiado')}`;
                    setTimeout(() => { button.innerHTML = original; }, 1400);
                })
                .catch(() => undefined);
            return;
        }

        try {
            localStorage.setItem(`capidocs_fb_${route}`, kind);
        } catch {
            return;
        }
        widget.querySelectorAll('.feedback-btn[data-feedback="up"], .feedback-btn[data-feedback="down"]').forEach((item) => {
            item.classList.toggle('active', item === button);
        });
        const question = widget.querySelector('.feedback-q');
        if (question) {
            question.textContent = kind === 'up'
                ? t('feedback_thanks_up', 'Gracias por tu comentario.')
                : t('feedback_thanks_down', 'Gracias, lo tendremos en cuenta.');
        }
    });
}
