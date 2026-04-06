/**
 * editor-text.js - Direct on-canvas text editing logic for VectorEditor. 
 * Manages the hidden input synchronization and blinking cursor effects.
 */

export function startTextAt(editor, pt) {
    editor._editingTextEl = editor._sketchLayer.text('|')
        .font({ family: editor._fontFamily, size: editor._fontSize, anchor: 'start' })
        .fill(editor._strokeColor)
        .attr('data-layer', document.getElementById('editorLayerSelect')?.value || "0")
        .css({ cursor: 'text', 'user-select': 'none' });
    
    editor._editingTextEl.attr({ x: pt.x, y: pt.y });
    const tspan = editor._editingTextEl.node.querySelector('tspan');
    if (tspan) { 
        tspan.setAttribute('x', pt.x); 
        tspan.removeAttribute('dy'); 
        tspan.setAttribute('y', pt.y); 
    }
    
    editor._currentText = '';
    initTextSession(editor);
}

export function beginTextEdit(editor, el) {
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = el;
    editor._currentText = el.text();
    editor._editingTextEl.plain(editor._currentText + '|');
    editor._editingTextEl.css({ cursor: 'text' });
    initTextSession(editor);
}

export function initTextSession(editor) {
    if (!editor._editingTextEl) return;
    
    const input = document.getElementById('editorHiddenInput');
    if (input) {
        input.value = editor._currentText;
        input.focus();
        
        // Move cursor to end
        const len = input.value.length;
        input.setSelectionRange(len, len);
        
        // Secondary focus for stubborn environments
        setTimeout(() => {
            if (editor._editingTextEl && document.activeElement !== input) {
                input.focus();
            }
        }, 50);
    } else {
        console.error('[EDITOR] Hidden input element NOT FOUND in document!');
    }

    // 1. Blinking cursor via interval
    let cursorVisible = true;
    editor._cursorBlinkInterval = setInterval(() => {
        if (!editor._editingTextEl) { 
            clearInterval(editor._cursorBlinkInterval); 
            return; 
        }
        cursorVisible = !cursorVisible;
        const display = editor._currentText + (cursorVisible ? '|' : ' ');
        editor._editingTextEl.plain(display);
        const ts = editor._editingTextEl.node.querySelector('tspan');
        if (ts) { 
            ts.setAttribute('x', ts.getAttribute('x') || 0); 
            ts.removeAttribute('dy'); 
        }
    }, 500);

    // 2. Sync hidden input to SVG text
    editor._textInputHandler = (e) => {
        const newVal = e.target.value;
        editor._currentText = newVal;
        editor._editingTextEl.plain(editor._currentText + '|');
        const tsp = editor._editingTextEl.node.querySelector('tspan');
        if (tsp) { tsp.removeAttribute('dy'); }
        if (editor._onChange) editor._onChange();
    };
    
    // 3. Handle control keys on input
    editor._textKeyHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitText(editor);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelText(editor);
        }
    };

    input?.addEventListener('input', editor._textInputHandler);
    input?.addEventListener('keydown', editor._textKeyHandler);
    
    // 4. Force focus back to input if clicking on search/etc
    editor._refocusHandler = () => { 
        if (editor._editingTextEl) {
            input?.focus(); 
        }
    };
    document.addEventListener('mousedown', editor._refocusHandler);
}

export function commitText(editor) {
    if (!editor._editingTextEl) return;

    clearInterval(editor._cursorBlinkInterval);
    
    const input = document.getElementById('editorHiddenInput');
    if (input) {
        input.removeEventListener('input', editor._textInputHandler);
        input.removeEventListener('keydown', editor._textKeyHandler);
        input.value = '';
        input.blur();
    }
    document.removeEventListener('mousedown', editor._refocusHandler);

    if (editor._currentText.trim() === '') {
        const elToRemove = editor._editingTextEl;
        editor._editingTextEl = null;
        editor._currentText = '';
        elToRemove.remove();
        if (editor._onChange) editor._onChange();
    } else {
        editor._editingTextEl.plain(editor._currentText);
        editor._editingTextEl.css({ cursor: 'pointer' });
        
        editor._editingTextEl = null;
        editor._currentText = '';
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function cancelText(editor) {
    if (!editor._editingTextEl) return;

    clearInterval(editor._cursorBlinkInterval);
    
    const input = document.getElementById('editorHiddenInput');
    if (input) {
        input.removeEventListener('input', editor._textInputHandler);
        input.removeEventListener('keydown', editor._textKeyHandler);
        input.value = '';
        input.blur();
    }
    document.removeEventListener('mousedown', editor._refocusHandler);

    editor._editingTextEl.remove();
    editor._editingTextEl = null;
    editor._currentText = '';
}

export function initText(editor) {
    // Hidden input setup
}

export function setFontFamily(editor, family) {
    editor._fontFamily = family;
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ family });
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function setFontSize(editor, size) {
    editor._fontSize = size;
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ size });
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}
