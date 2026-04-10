/**
 * ui-utils.js — DOM binding and synchronization.
 */

import { SLIDER_PAIRS, RESOLUTIONS } from './state.js';
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
        } else {
            val = e.target.value;
        }
        handler(val);
    });
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
    const input = document.getElementById(key);
    if (input) {
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value;
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

        document.body.style.userSelect = 'none';
        document.body.style.cursor = isMobile ? 'row-resize' : 'col-resize';
        resizer.setPointerCapture(e.pointerId);
    });

    resizer.addEventListener('pointermove', (e) => {
        if (!isResizing) return;

        if (isMobile) {
            const deltaY = e.clientY - startPos;
            const newHeight = Math.max(100, Math.min(startSize + deltaY, window.innerHeight - 150));
            app.style.setProperty('--preview-height', `${newHeight}px`);
        } else {
            const deltaX = e.clientX - startPos;
            const newWidth = Math.max(200, Math.min(startSize + deltaX, window.innerWidth - 200));
            app.style.setProperty('--sidebar-width', `${newWidth}px`);
        }

        if (preview) preview._resize();
    });

    resizer.addEventListener('pointerup', (e) => {
        isResizing = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        resizer.releasePointerCapture(e.pointerId);
        if (preview) preview._resize();
    });
}

/**
 * Injects mobile-specific viewport fixes (iOS notch/Safari height).
 */
export function setupMobileViewportHandling() {
  const fix = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  window.addEventListener('resize', fix);
  fix();
}
