import { el, on } from './dom.js';
import { performExpand } from './expand.js';

export function initExpandProperties(editor) {
    // The #toolExpand sidebar button is bound by tools/expand-tool.js; this
    // module owns only the property-row controls inside the Expand mode.

    const detailIn = el('editorExpandDetail');
    const runBtn = el('editorRunExpand');

    on(detailIn, 'change', () => { editor._expandDetail = parseFloat(detailIn.value) || 1.0; });
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

    // SA-DEAD-3: the Smoothness control's lookups/steppers/change-handler
    // removed — `editorExpandSmooth`/`-Minus`/`-Plus` have no matching
    // markup in the palette (only Detail's stepper exists there), so all
    // three `el()` calls always resolved null and every handler below
    // them silently no-op'd forever. `editor._expandSimplify` still has
    // its own default (set at editor construction) and is still read by
    // expandCurrent — this just removes the dead attempt to let a user
    // change it from a control that was never reachable. If Fred wants a
    // real Smoothness stepper back, it needs the matching markup added
    // (mirroring Detail's), not this dead wiring resurrected as-is.
}
