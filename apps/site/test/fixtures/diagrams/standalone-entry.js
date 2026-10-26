import { validateDiagramSet } from '../../../assets/js/diagram/model.js';
import { buildPdf } from '../../../assets/js/diagram/export/pdf.js';
import { svgToRaster } from '../../../assets/js/diagram/export/raster.js';
import { bytesToBase64 } from '../../../assets/js/diagram/export/sha256.js';

const root = document.getElementById('capidocs-standalone');
const result = validateDiagramSet(JSON.parse(document.getElementById('capidocs-diagram-set').textContent));
const heading = document.createElement('h1');
heading.textContent = result.ok ? result.set.title : '';
root.append(heading);
const list = document.createElement('ul');
for (const diagram of result.set?.diagrams ?? []) {
    const item = document.createElement('li');
    item.textContent = diagram.title;
    list.append(item);
}
root.append(list);

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="10" y="10" width="220" height="100" rx="12" fill="#2f8f90"/><text x="24" y="66" font-family="Geist" font-size="18" fill="#ffffff">Acción</text></svg>';
const fonts = await document.fonts.load('16px Geist');
const jpeg = new Uint8Array(await (await svgToRaster(svg, { scale: 2, type: 'image/jpeg' })).arrayBuffer());
const png = await svgToRaster(svg, { scale: 1 });
const pdf = buildPdf([{
    width: 240,
    height: 120,
    jpeg,
    imageWidth: 480,
    imageHeight: 240,
    texts: [{ x: 24, y: 66, size: 18, width: 120, text: 'Diagrama de acción: ¿Niño? ¡Sí! Pingüino' }]
}], { title: result.set?.title ?? '', lang: 'es' });

window.capidocsTest = { pdf: bytesToBase64(pdf), jpegBytes: jpeg.length, pngType: png.type, pngBytes: png.size, fontsLoaded: fonts.length };
document.documentElement.dataset.capidocs = result.ok ? 'ready' : 'failed';
