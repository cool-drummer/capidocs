import { approximateMeasure } from '../metrics.js';
import { layoutGraph } from './graph.js';
import { layoutSequence } from './sequence.js';

export { defaultCollapsed, defaultExpanded } from './graph.js';

export function layoutDiagram(diagram, { measure = approximateMeasure, expanded, collapsed } = {}) {
    if (diagram.kind === 'sequence') return layoutSequence(diagram, { measure });
    return layoutGraph(diagram, { measure, expanded, collapsed });
}
