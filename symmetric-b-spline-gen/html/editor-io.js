/**
 * editor-io.js - persistence logic for VectorEditor. 
 * Handles SVG serialization and re-import.
 */

export function initIO(editor) {
    editor.logEditorEvent = (msg, data) => {
        console.log(`[SVG EDITOR] ${msg}`, data || '');
    };
}

export function save(editor, dpi = 96) {
    if (!editor._draw) return "";
    const rawContent = editor._sketchLayer.node.innerHTML;
    const content = rawContent.replace(/\s+svgjs:[^=]+="[^"]*"/g, '');
    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">${content}</svg>`;
    editor.lastSvg = svgString;
    return svgString;
}

export function open(editor, svgString, w, h) {
    editor.setModelMetrics(w, h);
    editor._sketchLayer.clear();
    sync3DBackground(editor);
    if (!svgString) return;
    try {
        const svgEl = new DOMParser().parseFromString(svgString, 'image/svg+xml').querySelector('svg');
        if (svgEl) {
            editor._sketchLayer.svg(svgEl.innerHTML);
            editor._sketchLayer.children().forEach(ch => {
                if (ch.hasClass('calib-anchor')) ch.remove();
                ch.attr('transform', null);
                ch.css('cursor', ch.type === 'text' ? 'text' : 'pointer');
            });
        }
    } catch (err) { console.error('[SVG EDITOR] Re-import failure:', err); }
}

export function sync3DBackground(editor) {
    const topViewCanvas = document.getElementById('svgEditorTopView');
    if (topViewCanvas && editor._draw) {
        editor._bgLayer.clear();
        editor._bgLayer.image(topViewCanvas.toDataURL("image/png"))
            .size(editor._mW, editor._mH)
            .attr({ opacity: 1.0, preserveAspectRatio: 'none' });
        
        if (editor._border) editor._border.remove();
        editor._border = editor._bgLayer.rect(editor._mW, editor._mH)
          .fill('none')
          .stroke({ color: '#ff0000', width: 0.01, dasharray: '0.1,0.1' });
    }
}

export function getPointerPos(editor, e) {
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    return editor._draw.point(clientX, clientY);
}
