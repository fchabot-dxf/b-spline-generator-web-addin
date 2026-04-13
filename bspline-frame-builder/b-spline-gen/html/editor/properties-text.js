import { el, query, addClass } from './dom.js';
import { insertSymbol } from './editor-text.js';

export function initTextProperties(editor) {
  const fontFamilyEl = el('editorFontFamily');
  const fontSizeEl = el('editorFontSize');
  const fsMinus = el('editorFontSizeMinus');
  const fsPlus = el('editorFontSizePlus');
  const symbolToggle = el('editorSymbolKeyboardToggle');
  const symbolPanel = el('editorSymbolKeyboard');
  const symbolClose = el('editorSymbolKeyboardClose');
  const symbolFamily = el('editorSymbolFamily');
  const canvasContainer = el('editorCanvasContainer');

  if (fontFamilyEl) {
    fontFamilyEl.addEventListener('change', () => {
      editor.setFontFamily(fontFamilyEl.value);
    });
  }

  if (fontSizeEl) {
    fontSizeEl.addEventListener('input', () => {
      const s = parseFloat(fontSizeEl.value);
      if (!Number.isNaN(s) && s > 0) editor.setFontSize(s);
    });
  }

  const stepFontSize = (delta) => {
    if (!fontSizeEl) return;
    const cur = parseFloat(fontSizeEl.value) || editor._fontSize;
    const next = Math.max(0.2, Math.round((cur + delta) * 10) / 10);
    fontSizeEl.value = next;
    editor.setFontSize(next);
  };

  fsMinus?.addEventListener('click', () => stepFontSize(-0.2));
  fsPlus?.addEventListener('click', () => stepFontSize(+0.2));

  const updateKeyboardPadding = () => {
    if (!canvasContainer || !symbolPanel) return;
    const isOpen = !symbolPanel.classList.contains('hidden');
    if (isOpen) {
      const height = symbolPanel.getBoundingClientRect().height;
      canvasContainer.style.paddingBottom = `${height}px`;
    } else {
      canvasContainer.style.paddingBottom = '';
    }
  };

  if (symbolToggle && symbolPanel && symbolFamily) {
    symbolToggle.addEventListener('click', () => {
      const isOpen = !symbolPanel.classList.toggle('hidden');
      canvasContainer?.classList.toggle('keyboard-open', isOpen);
      if (isOpen) {
        populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
        symbolFamily.focus();
      }
      updateKeyboardPadding();
    });
  }

  symbolClose?.addEventListener('click', () => {
    if (symbolPanel) addClass(symbolPanel, 'hidden');
    canvasContainer?.classList.remove('keyboard-open');
    updateKeyboardPadding();
  });

  symbolFamily?.addEventListener('change', () => {
    if (symbolPanel && !symbolPanel.classList.contains('hidden')) {
      populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
      updateKeyboardPadding();
    }
  });

  const keyboardGrip = query('.editor-symbol-keyboard-grip');
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
      updateKeyboardPadding();
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
}

function populateSymbolKeyboard(editor, family = 'Symbol') {
  const grid = el('editorSymbolKeyboardGrid');
  const panel = el('editorSymbolKeyboard');
  if (!grid || !panel) return;
  grid.innerHTML = '';

  const range = {
    Symbol: { start: 32, end: 255 },
    Webdings: { start: 32, end: 255 },
    Wingdings: { start: 32, end: 255 },
    'Segoe UI Symbol': { start: 32, end: 255 },
    'Segoe MDL2 Assets': { start: 0xE700, end: 0xE7FF },
    'Segoe Fluent Icons': { start: 0xF700, end: 0xF7FF },
    'Segoe UI Emoji': { start: 0x1F300, end: 0x1F35F }
  }[family] || { start: 32, end: 255 };

  const count = Math.max(0, range.end - range.start + 1);
  panel.style.width = '';
  panel.style.height = '';
  panel.style.maxHeight = window.innerWidth <= 720 ? '55vh' : '40vh';

  for (let code = range.start; code <= range.end; code++) {
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
    btn.style.fontFamily = `'${family}', sans-serif`;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      if (editor._editingTextEl) {
        insertSymbol(editor, char, family);
      } else {
        alert('Open a text object and start editing before inserting symbols.');
      }
    });
    grid.appendChild(btn);
  }
}
