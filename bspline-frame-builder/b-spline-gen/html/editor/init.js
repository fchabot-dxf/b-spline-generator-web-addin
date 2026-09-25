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
    // SE6: grid sits above the background but below the drawing, so it
    // reads as a faint reference under the artwork rather than over it.
    const gridLayer = draw.group().id('grid-layer');
    const sketchLayer = draw.group().id('sketch-layer');
    // SE12 T37: a SIBLING of sketchLayer, not a child — every reader that
    // matters (serializeEditor/save/getLayerSvg, hit-testing, selection,
    // pushState's undo snapshot, refreshDrape) walks ONLY
    // sketchLayer.children(), so a sibling group is excluded from all of
    // them by construction, the same free exclusion handleLayer/
    // highlightLayer already get — no filtering code needed anywhere else.
    // pointer-events:none on the group covers every descendant path.
    const outlinePreviewLayer = draw.group().id('outlinePreview').attr('pointer-events', 'none');
    const handleLayer = draw.group().id('handle-layer');
    const highlightLayer = draw.group().id('highlight-layer');

    return { draw, bgLayer, gridLayer, sketchLayer, outlinePreviewLayer, handleLayer, highlightLayer };
}
