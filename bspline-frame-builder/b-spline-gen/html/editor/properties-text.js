import { el, query, addClass } from './dom.js';
import { insertSymbol } from './editor-text.js';
import { injectFontFaceRules, verifyFontLoaded, SYMBOL_FAMILIES } from './editor-fonts.js';

export function initTextProperties(editor) {
  // Register @font-face rules for the bundled symbol fonts before any
  // keyboard rendering happens. Idempotent — safe even if some other
  // editor entry point ends up calling this twice.
  injectFontFaceRules();

  const fontFamilyEl = el('editorFontFamily');
  const fontSizeEl = el('editorFontSize');
  const fsMinus = el('editorFontSizeMinus');
  const fsPlus = el('editorFontSizePlus');
  const symbolToggle = el('editorSymbolKeyboardToggle');
  const symbolPanel = el('editorSymbolKeyboard');
  const symbolClose = el('editorSymbolKeyboardClose');
  const symbolFamily = el('editorSymbolFamily');
  const canvasContainer = el('editorCanvasContainer').parentElement;

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
      canvasContainer.style.paddingBottom = '0px';
    }
  };

  // Suppress / restore the iOS-native software keyboard while the Symbol
  // Keyboard is open. The text editor uses #editorHiddenInput as its
  // input surface — when that input has focus on iOS, Safari pops up its
  // own keyboard and covers our Symbol Keyboard. Setting inputmode="none"
  // keeps the input focusable and event-driven (so insertSymbol's
  // programmatic writes still work) but tells iOS NOT to show its
  // keyboard. We blur+refocus when toggling so iOS actually re-evaluates
  // the inputmode change in the same gesture instead of next focus.
  //
  // Restore path REMOVES the attribute entirely rather than asserting
  // inputmode='text'. iOS Safari has a quirk where dynamically setting
  // inputmode (even to its default) can suppress the keyboard popup on
  // the same gesture, breaking plain text editing. Removing the
  // attribute leaves the input in its native default state.
  const syncNativeKeyboardSuppression = (suppress) => {
    const input = document.getElementById('editorHiddenInput');
    if (!input) return;
    if (suppress) {
      input.setAttribute('inputmode', 'none');
    } else {
      input.removeAttribute('inputmode');
    }
    if (document.activeElement === input) {
      input.blur();
      // Re-focus on next tick so editor._editingTextEl can keep typing.
      setTimeout(() => {
        if (editor && editor._editingTextEl) input.focus();
      }, 0);
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
      syncNativeKeyboardSuppression(isOpen);
      updateKeyboardPadding();
    });
  }

  symbolClose?.addEventListener('click', () => {
    if (symbolPanel) addClass(symbolPanel, 'hidden');
    canvasContainer?.classList.remove('keyboard-open');
    syncNativeKeyboardSuppression(false);
    updateKeyboardPadding();
  });

  symbolFamily?.addEventListener('change', () => {
    if (symbolPanel && !symbolPanel.classList.contains('hidden')) {
      populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
      updateKeyboardPadding();
    }
  });

  window.addEventListener('resize', updateKeyboardPadding);

  const keyboardGrip = query('.editor-symbol-keyboard-grip');
  if (keyboardGrip && symbolPanel) {
    let dragStartY = null;
    let startHeight = 0;
    const minHeight = 120;
    const getMaxHeight = () => Math.min(window.innerHeight - 120, Math.round(window.innerHeight * 0.85));
    const setKeyboardHeight = (height) => {
      const maxHeight = getMaxHeight();
      const clamped = Math.min(maxHeight, Math.max(minHeight, height));

      requestAnimationFrame(() => {
        symbolPanel.style.setProperty('--keyboard-max-height', `${clamped}px`);
        symbolPanel.style.height = `${clamped}px`;

        if (canvasContainer) {
          if (window.innerWidth <= 720) {
            const ratio = (clamped - minHeight) / (maxHeight - minHeight);
            const sidePadding = ratio * 60;
            canvasContainer.style.setProperty('--mobile-dynamic-padding', `${sidePadding}px`);
          } else {
            canvasContainer.style.paddingBottom = `${clamped}px`;
          }
        }
      });
    };
    const onPointerMove = (event) => {
      if (dragStartY === null) return;
      const delta = event.clientY - dragStartY;
      setKeyboardHeight(startHeight - delta);
      event.preventDefault();
    };
    const onTouchMove = (event) => {
      if (dragStartY === null) return;
      const touch = event.touches[0];
      if (!touch) return;
      const delta = touch.clientY - dragStartY;
      setKeyboardHeight(startHeight - delta);
      event.preventDefault();
    };
    const stopDrag = () => {
      dragStartY = null;
      symbolPanel.classList.remove('grabbing');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stopDrag);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', stopDrag);
    };

    const startDrag = (clientY, event) => {
      if (symbolPanel.classList.contains('hidden')) return;
      dragStartY = clientY;
      startHeight = symbolPanel.getBoundingClientRect().height;
      symbolPanel.classList.add('grabbing');
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', stopDrag);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', stopDrag);
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    };

    keyboardGrip.addEventListener('pointerdown', (event) => {
      if (symbolPanel.classList.contains('hidden')) return;
      keyboardGrip.setPointerCapture(event.pointerId);
      startDrag(event.clientY, event);
    });

    keyboardGrip.addEventListener('touchstart', (event) => {
      if (symbolPanel.classList.contains('hidden')) return;
      const touch = event.touches[0];
      if (!touch) return;
      startDrag(touch.clientY, event);
    }, { passive: false });
  }
}

/**
 * Show or hide a banner inside the Symbol Keyboard panel warning the
 * user that the requested symbol font failed to load. This is the
 * runtime self-test surface — when it appears, something in the font
 * pipeline (editor-fonts.js / .ttf files / network) has regressed and
 * needs investigating. Don't suppress the banner; it's the early-warning
 * system that prevents the iOS keyboard bug from coming back silently.
 */
function setKeyboardFontWarning(panel, family, isLoaded) {
  if (!panel) return;
  let banner = panel.querySelector('.editor-symbol-keyboard-warning');
  if (isLoaded) {
    if (banner) banner.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'editor-symbol-keyboard-warning';
    banner.setAttribute('role', 'alert');
    // Insert just below the grip / above the family selector for visibility.
    const grip = panel.querySelector('.editor-symbol-keyboard-grip');
    if (grip && grip.nextSibling) {
      panel.insertBefore(banner, grip.nextSibling);
    } else {
      panel.insertBefore(banner, panel.firstChild);
    }
  }
  banner.textContent = `⚠ "${family}" font failed to load — symbol glyphs may render as plain Latin characters. Check editor-fonts.js / fonts directory.`;
}

function populateSymbolKeyboard(editor, family = 'Symbol') {
  const grid = el('editorSymbolKeyboardGrid');
  const panel = el('editorSymbolKeyboard');
  if (!grid || !panel) return;
  console.log(`[COORD_STD] properties-text: populating Symbol Keyboard with family "${family}"`);
  grid.innerHTML = '';

  // Runtime self-test: only meaningful for families that we explicitly
  // bundle as @font-face. For system-only families we'd get false
  // positives because document.fonts.check returns true regardless.
  if (SYMBOL_FAMILIES.has(family)) {
    verifyFontLoaded(family).then(ok => {
      if (!ok) {
        console.warn(`[editor-fonts] Symbol Keyboard: font "${family}" failed to load. Banner shown to user.`);
      }
      setKeyboardFontWarning(panel, family, ok);
    });
  } else {
    setKeyboardFontWarning(panel, family, true);
  }

  // Reverted to 'svg-editor' branch style: 32-255 ASCII range, no Base64/PUA offsets
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
  const defaultHeight = window.innerWidth <= 720 ? '40vh' : '50vh';
  const maxHeight = window.innerWidth <= 720 ? '80vh' : '80vh';
  panel.style.width = '100%';
  panel.style.height = defaultHeight;
  panel.style.removeProperty('max-height');
  panel.style.setProperty('--keyboard-max-height', maxHeight);

  for (let code = range.start; code <= range.end; code++) {
    const char = String.fromCodePoint(code);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'symbol-key';
    btn.textContent = char;
    
    // Apply font with fallbacks
    btn.style.fontFamily = `'${family}', "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
    
    btn.onclick = () => {
        console.log(`[COORD_STD] Symbol clicked: ${char} (0x${code.toString(16).toUpperCase()}) using font: ${family}`);
        if (editor && editor._editingTextEl) {
            insertSymbol(editor, char, family);
        } else {
            alert('Select a text object or click the canvas to start typing before inserting symbols.');
        }
    };
    grid.appendChild(btn);
  }

  // Add invisible placeholder buttons at the bottom to reserve safe space under mobile browser UI.
  for (let i = 0; i < 8; i++) {
    const placeholder = document.createElement('button');
    placeholder.type = 'button';
    placeholder.className = 'symbol-key symbol-key-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.tabIndex = -1;
    grid.appendChild(placeholder);
  }

  if (typeof window !== 'undefined') {
    window.populateSymbolKeyboard = (editorInstance, family = 'Symbol') => populateSymbolKeyboard(editorInstance, family);
  }
}
