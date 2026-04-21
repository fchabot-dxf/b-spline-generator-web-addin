import { el } from './dom.js';

export function createEditorCanvas(containerId) {
    const container = el(containerId);
    if (!container) {
        throw new Error(`Editor container not found: ${containerId}`);
    }

    container.innerHTML = '';
    if (!window.SVG) {
        throw new Error('SVG.js is not loaded.');
    }

    const draw = window.SVG().addTo('#' + containerId).size('100%', '100%');
    
    const bgLayer = draw.group().id('bg-layer');
    const sketchLayer = draw.group().id('sketch-layer');
    const handleLayer = draw.group().id('handle-layer');
    const highlightLayer = draw.group().id('highlight-layer');

    return { draw, bgLayer, sketchLayer, handleLayer, highlightLayer };
}
