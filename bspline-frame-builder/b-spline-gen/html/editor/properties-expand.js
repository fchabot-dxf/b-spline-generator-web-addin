import { el, on } from './dom.js';
import { performExpand } from './expand.js';

export function initExpandProperties(editor) {
    // The #toolExpand sidebar button is bound by tools/expand-tool.js; this
    // module owns only the property-row controls inside the Expand mode.

    const detailIn = el('editorExpandDetail');
    const smoothIn = el('editorExpandSmooth');
    const runBtn = el('editorRunExpand');

    on(detailIn, 'change', () => { editor._expandDetail = parseFloat(detailIn.value) || 1.0; });
    on(smoothIn, 'change', () => { editor._expandSimplify = parseInt(smoothIn.value) || 15; });
    on(runBtn, 'click', () => performExpand(editor));

    // Steppers for Detail
    const dMinus = el('editorExpandDetailMinus');
    const dPlus = el('editorExpandDetailPlus');
    if (dMinus && dPlus && detailIn) {
        on(dMinus, 'click', () => {
            detailIn.value = (parseFloat(detailIn.value) - 0.2).toFixed(1);
            detailIn.dispatchEvent(new Event('change'));
        });
        on(dPlus, 'click', () => {
            detailIn.value = (parseFloat(detailIn.value) + 0.2).toFixed(1);
            detailIn.dispatchEvent(new Event('change'));
        });
    }

    // Steppers for Smoothness
    const sMinus = el('editorExpandSmoothMinus');
    const sPlus = el('editorExpandSmoothPlus');
    if (sMinus && sPlus && smoothIn) {
        on(sMinus, 'click', () => {
            smoothIn.value = parseInt(smoothIn.value) - 1;
            smoothIn.dispatchEvent(new Event('change'));
        });
        on(sPlus, 'click', () => {
            smoothIn.value = parseInt(smoothIn.value) + 1;
            smoothIn.dispatchEvent(new Event('change'));
        });
    }
}
