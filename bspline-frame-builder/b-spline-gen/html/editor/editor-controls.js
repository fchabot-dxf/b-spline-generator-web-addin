import { insertSymbol } from './editor-text.js';

const SYMBOL_FONT_RANGES = {
    'Symbol': { start: 32, end: 255 },
    'Webdings': { start: 32, end: 255 },
    'Wingdings': { start: 32, end: 255 },
    'Segoe UI Symbol': { start: 32, end: 255 },
    'Segoe MDL2 Assets': { start: 0xE700, end: 0xE7FF },
    'Segoe Fluent Icons': { start: 0xF700, end: 0xF7FF },
    'Segoe UI Emoji': { start: 0x1F300, end: 0x1F35F }
};

function populateSymbolKeyboard(editor, family = 'Symbol') {
    const grid = document.getElementById('editorSymbolKeyboardGrid');
    const panel = document.getElementById('editorSymbolKeyboard');
    if (!grid || !panel) return;
    grid.innerHTML = '';

    const fontFamily = family || 'Symbol';
    const range = SYMBOL_FONT_RANGES[fontFamily] || { start: 32, end: 255 };
    const start = range.start;
    const end = range.end;
    const count = Math.max(0, end - start + 1);
    const isMobile = window.innerWidth <= 720;
    const columns = isMobile
        ? Math.min(6, Math.max(4, Math.ceil(Math.sqrt(count))))
        : Math.min(16, Math.max(8, Math.ceil(Math.sqrt(count))));
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(30px, 1fr))`;

    if (isMobile) {
        panel.style.width = '';
        panel.style.height = '';
        panel.style.maxHeight = '55vh';
    } else {
        const rowCount = Math.ceil(count / columns);
        const height = Math.min(420, Math.max(180, rowCount * 36 + 90));
        panel.style.height = `${height}px`;
        panel.style.width = `${Math.min(420, Math.max(260, columns * 36 + 24))}px`;
    }

    for (let code = start; code <= end; code++) {
        const char = String.fromCodePoint(code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'symbol-key';
        btn.textContent = char;
        btn.style.all = 'unset';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.width = '100%';
        btn.style.height = '34px';
        btn.style.border = '1px solid rgba(0,0,0,0.1)';
        btn.style.borderRadius = '4px';
        btn.style.background = 'var(--surface2)';
        btn.style.color = 'var(--text)';
        btn.style.fontFamily = `'${fontFamily}', sans-serif`;
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => {
            if (editor._editingTextEl) {
                insertSymbol(editor, char, fontFamily);
            } else {
                alert('Open a text object and start editing before inserting symbols.');
            }
        });
        grid.appendChild(btn);
    }
}

function setupEditorToolbar(editor) {
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };

    bind('toolSelect', () => editor.setMode('select'));
    bind('toolNode', () => editor.setMode('node'));
    bind('toolDraw', () => editor.setMode('draw'));
    bind('toolLine', () => editor.setMode('line'));
    bind('toolRect', () => editor.setMode('rect'));
    bind('toolCircle', () => editor.setMode('circle'));
    bind('toolText', () => editor.setMode('text'));
    bind('toolDelete', () => editor.deleteSelected());
    bind('toolExpand', () => editor.expandAction());
    bind('editorUndo', () => editor.undo());
    bind('editorDownload', async () => {
        const svgText = await editor.saveWithTextCopies();
        if (!svgText) return;
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:T]/g, '-').replace(/\.\d+Z$/, '');
        const name = `svg-editor-${timestamp}.svg`;
        if (typeof saveAs === 'function') {
            saveAs(blob, name);
        } else {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });
    bind('editorClear', () => {
        if (confirm('Clear all?')) {
            editor._sketchLayer.clear();
            editor.pushState();
            if (editor._onChange) editor._onChange();
        }
    });

    bind('editorApply', () => {
        editor._commitText();
        if (editor._onCommit) editor._onCommit(editor.save());
    });
    bind('editorCancel', () => {
        if (editor._onCommit) editor._onCommit(null);
    });

    const strokeSld = document.getElementById('editorStrokeWidthSlider');
    const strokeNum = document.getElementById('editorStrokeWidth');
    if (strokeSld && strokeNum) {
        strokeSld.addEventListener('input', () => {
            strokeNum.value = strokeSld.value;
            editor.setStrokeWidth(parseFloat(strokeSld.value));
        });
        strokeNum.addEventListener('input', () => {
            strokeSld.value = strokeNum.value;
            editor.setStrokeWidth(parseFloat(strokeNum.value));
        });
    }

    const fontFamilyEl = document.getElementById('editorFontFamily');
    if (fontFamilyEl) {
        fontFamilyEl.addEventListener('change', () => {
            editor.setFontFamily(fontFamilyEl.value);
        });
    }

    const fontSizeEl = document.getElementById('editorFontSize');
    if (fontSizeEl) {
        fontSizeEl.addEventListener('input', () => {
            const s = parseFloat(fontSizeEl.value);
            if (!isNaN(s) && s > 0) editor.setFontSize(s);
        });
    }

    const fsMinus = document.getElementById('editorFontSizeMinus');
    const fsPlus = document.getElementById('editorFontSizePlus');
    const stepFontSize = (delta) => {
        if (!fontSizeEl) return;
        const cur = parseFloat(fontSizeEl.value) || editor._fontSize;
        const next = Math.max(0.2, Math.round((cur + delta) * 10) / 10);
        fontSizeEl.value = next;
        editor.setFontSize(next);
    };
    fsMinus?.addEventListener('click', () => stepFontSize(-0.2));
    fsPlus?.addEventListener('click', () => stepFontSize(+0.2));

    const symbolToggle = document.getElementById('editorSymbolKeyboardToggle');
    const symbolPanel = document.getElementById('editorSymbolKeyboard');
    const symbolClose = document.getElementById('editorSymbolKeyboardClose');
    const symbolFamily = document.getElementById('editorSymbolFamily');
    const canvasContainer = document.getElementById('editorCanvasContainer');

    if (symbolToggle && symbolPanel && symbolFamily) {
        symbolToggle.addEventListener('click', () => {
            const isOpen = !symbolPanel.classList.toggle('hidden');
            canvasContainer?.classList.toggle('keyboard-open', isOpen);
            if (isOpen) {
                populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
                symbolFamily.focus();
            }
        });
    }

    symbolClose?.addEventListener('click', () => {
        if (symbolPanel) symbolPanel.classList.add('hidden');
        canvasContainer?.classList.remove('keyboard-open');
    });

    symbolFamily?.addEventListener('change', () => {
        if (symbolPanel && !symbolPanel.classList.contains('hidden')) {
            populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
        }
    });

    const keyboardGrip = document.querySelector('.editor-symbol-keyboard-grip');
    if (keyboardGrip && symbolPanel) {
        let dragStartY = null;
        let startHeight = 0;
        const minHeight = 120;
        const maxHeight = 420;
        const setKeyboardHeight = (height) => {
            const clamped = Math.min(maxHeight, Math.max(minHeight, height));
            symbolPanel.style.setProperty('--keyboard-max-height', `${clamped}px`);
        };
        const onPointerMove = (event) => {
            if (dragStartY === null) return;
            const delta = event.clientY - dragStartY;
            setKeyboardHeight(startHeight - delta);
        };
        const onPointerUp = () => {
            dragStartY = null;
            symbolPanel.classList.remove('grabbing');
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        };
        keyboardGrip.addEventListener('pointerdown', (event) => {
            if (symbolPanel.classList.contains('hidden')) return;
            dragStartY = event.clientY;
            startHeight = symbolPanel.getBoundingClientRect().height;
            symbolPanel.classList.add('grabbing');
            keyboardGrip.setPointerCapture(event.pointerId);
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            event.preventDefault();
        });
    }

    const sidebarToggle = document.getElementById('editorSidebarToggle');
    const sidebar = document.querySelector('.editor-sidebar');
    sidebarToggle?.addEventListener('click', () => {
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
    });
}

export { setupEditorToolbar };
