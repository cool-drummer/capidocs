import { loadSpec } from './spec-loader.js';
import { createCapidocs } from './app.js';

function renderLoadError() {
    const main = document.getElementById('main-content');
    if (!main) return;
    main.innerHTML = `
        <div class="error-page">
            <div class="error-content">
                <div class="error-badge"><i class="fas fa-triangle-exclamation"></i></div>
                <h2 class="error-title">No pudimos cargar la documentación</h2>
                <p class="error-desc">Ocurrió un problema al obtener el contenido. Vuelve a intentarlo en un momento.</p>
                <div class="error-actions">
                    <button class="btn btn-primary" type="button" data-reload>Volver a intentar</button>
                </div>
            </div>
        </div>`;
    main.querySelector('[data-reload]').addEventListener('click', () => location.reload());
}

try {
    const spec = await loadSpec();
    window.capidocs = await createCapidocs({ spec });
} catch (error) {
    console.error('capidocs failed to start:', error);
    renderLoadError();
    document.documentElement.dataset.capidocs = 'failed';
}
