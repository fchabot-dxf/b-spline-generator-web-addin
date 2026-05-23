/**
 * ui-utils.js — DOM binding and synchronization.
 */

import { INPUT_PAIRS, SLIDER_PAIRS, RESOLUTIONS } from './state.js';
import { resolveGrid } from './terrain.js';

/**
 * Binds a UI control (input/select) to a handler.
 */
export function bind(id, type, handler, immediate = false, desc = '') {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`[bind] Element not found: #${id}`);
        return;
    }
    const eventType = (el.tagName === 'SELECT' || type === 'select') ? 'change' : 'input';
    el.addEventListener(eventType, e => {
        let val;
        if (type === 'checkbox') {
            val = e.target.checked;
        } else if (type === 'number') {
            val = parseFloat(e.target.value);
            // Intermediate states like "" or "." parse to NaN — the user
            // is mid-edit. Don't propagate NaN to P (it'd echo back
            // "NaN" into the field via syncUItoParam and wreck the UI).
            if (Number.isNaN(val)) return;
        } else {
            val = e.target.value;
        }
        handler(val);
    });

    // For number inputs, ALSO listen on 'change' (fires on blur / commit).
    // syncUItoParam skips writeback while the input is focused, so any
    // clamping done in the handler (e.g. widthIn capped to 96) is invisible
    // until the user leaves the field. By re-firing the handler on blur —
    // when activeElement has moved off the input — syncUItoParam writes
    // the clamped value back and the field snaps from "200" → "96".
    if (type === 'number') {
        el.addEventListener('change', e => {
            const val = parseFloat(e.target.value);
            if (Number.isNaN(val)) return;
            handler(val);
        });
    }
    if (immediate) {
        let val = el.value;
        if (type === 'number') val = parseFloat(val);
        handler(val);
    }
}

/**
 * Syncs a slider with its number input counterpart and vice-versa.
 */
export function syncPair(numId, sldId, desc = '') {
    const num = document.getElementById(numId);
    const sld = document.getElementById(sldId);
    if (!num || !sld) return;

    num.addEventListener('input', () => { sld.value = num.value; });
    sld.addEventListener('input', () => {
        num.value = sld.value;
        num.dispatchEvent(new Event('input'));
    });
}

/**
 * Syncs current State value to the UI (used for Undo/Redo/Init)
 */
export function syncUItoParam(key, value) {
    const inputId = INPUT_PAIRS[key] || key;
    const input = document.getElementById(inputId);
    if (input) {
        if (input.type === 'checkbox') {
            input.checked = !!value;
            // Programmatic .checked = … doesn't fire 'change'. Listeners
            // registered in bindTogglePanel rely on 'change' to keep
            // dependent panels in sync; dispatch one explicitly so the
            // initial sync from P state matches user-toggle behaviour.
            input.dispatchEvent(new Event('change'));
        } else {
            // Do NOT overwrite the input the user is actively typing in.
            // Otherwise, typing "7." on a number input echoes back
            // parseFloat("7.")===7, the dot disappears, and the caret
            // ends up one digit to the left of where the user dropped it.
            // For sliders / programmatic updates the input is not
            // focused, so the writeback still happens normally.
            if (document.activeElement !== input) {
                input.value = value;
            }
        }
    }
    const sliderId = SLIDER_PAIRS[key];
    if (sliderId) {
        const slider = document.getElementById(sliderId);
        if (slider) slider.value = value;
    }
}

/**
 * Updates the display labels in the resolution/spacing dropdown.
 */
export function updateSpacingLabels(widthIn, heightIn) {
    const sel = document.getElementById('spacing');
    if (!sel) return;

    const currentVal = sel.value;
    sel.innerHTML = '';

    RESOLUTIONS.forEach(r => {
        const { nx, nz } = resolveGrid(widthIn, heightIn, r.val);
        const opt = document.createElement('option');
        opt.value = r.val.toString();
        opt.textContent = `${r.name} — ${r.val}" (~${nx}×${nz} pts)`;
        if (opt.value === currentVal) opt.selected = true;
        sel.appendChild(opt);
    });
}

/**
 * Main resize handler for the entire app.
 */
export function resizeApp(preview) {
    if (preview) {
        preview._resize();

        if (preview.camera) {
            if (window.innerWidth <= 700) {
                preview.camera.zoom = 1.8;
            } else {
                preview.camera.zoom = 1.25;
            }
            preview.camera.updateProjectionMatrix();
        }
    }
}

/**
 * Initializes the draggable resizer for the sidebar/preview boundary.
 */
export function initResizer(preview) {
    const resizer = document.getElementById('resizer');
    const app = document.querySelector('.app');
    if (!resizer || !app) return;

    let isResizing = false;
    let isMobile = false;
    let startPos = 0;
    let startSize = 0;

    resizer.addEventListener('pointerdown', (e) => {
        isResizing = true;
        isMobile = window.innerWidth <= 700;

        if (isMobile) {
            startPos = e.clientY;
            const previewArea = document.getElementById('previewArea');
            startSize = previewArea ? previewArea.getBoundingClientRect().height : 0;
        } else {
            startPos = e.clientX;
            const aside = document.querySelector('aside');
            startSize = aside ? aside.getBoundingClientRect().width : 0;
        }