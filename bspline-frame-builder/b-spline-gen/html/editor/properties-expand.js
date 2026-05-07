import { el } from './dom.js';
import { performExpand } from './expand.js';

export function initExpandProperties(editor) {
    // The #toolExpand sidebar button is bound by tools/expand-tool.js; this
    // module owns only the property-row controls inside the Expand mode.

    const detailIn = el('editorExpandDetail');
    const smoothIn = el('editorExpandSmooth');
    const runBtn = el('editorRunExpand');

    if (detailIn) {
        detailIn.addEventListener('change', () => {
            editor._expandDetail = parseFloat(detailIn.value) || 1.0;
        });
    }
    if (smoothIn) {
        smoothIn.addEventListener('change', () => {
            editor._expandSimplify = parseInt(smoothIn.value) || 15;
        });
    }

    if (runBtn) {
        runBtn.addEventListener('click', () => {
            performExpand(editor);
        });
    }

    // 4. Steppers for Detail
    const dMinus = el('editorExpandDetailMinus');
    const dPlus = el('editorExpandDetailPlus');
    if (dMinus && dPlus && detailIn) {
        dMinus.addEventListener('click', () => {
            detailIn.value = (parseFloat(detailIn.value) - 0.2).toFixed(1);
            detailIn.dispatchEvent(new Event('change'));
        });
        dPlus.addEventListener('click', () => {
            detailIn.value = (parseFloat(detailIn.value) + 0.2).toFixed(1);
            detailIn.dispatchEvent(new Event('change'));
        });
    }

    // 5. Steppers for Smoothness
    const sMinus = el('editorExpandSmoothMinus');
    const sPlus = el('editorExpandSmoothPlus');
    if (sMinus && sPlus && smoothIn) {
        sMinus.addEventListener('click', () => {
            smoothIn.value = parseInt(smoothIn.value) - 1;
            smoothIn.dispatchEvent(new Event('change'));
        });
        sPlus.addEventListener('click', () => {
            smoothIn.value = parseInt(smoothIn.value) + 1;
            smoothIn.dispatchEvent(new Event('change'));
        });
    }
}
