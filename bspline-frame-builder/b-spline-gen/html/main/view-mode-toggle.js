/**
 * main/view-mode-toggle.js -- F35 item 25 (Fred: "in the viewport have a 2D 3D toggle that enters and exits editor
 * mode"). A two-state pill [2D | 3D]:
 *   2D -- open the editor on the LAST-USED tab (the editor tab last switched to; the Brick section's button
 *         leaves Brick, for example);
 *   3D -- leave the editor the APPLY way (the real Apply button: keep the work, build the 3D, its loading
 *         signal); when nothing changed since it opened (app-init.js editorSessionFingerprint), just close.
 *         Cancel stays in the editor header for discarding.
 * Declared: VIEW_MODES (the two states) and VIEW_TOGGLE_HOSTS (where a pill is drawn, and which state that place
 * IS -- the 3D viewport's pill shows 3D active, the editor's shows 2D: each host is only visible in its own
 * mode, so neither needs syncing). Desktop and phone alike.
 */
import { isEditorOpen } from '../core/history.js';
import { SvgEditorSnapshot, editorSessionFingerprint, closeEditorUnchanged } from './app-init.js';
import { openEditorOn } from './frame-panel.js';
import { getEditorTab } from './editor-tabs.js';

export const VIEW_MODES = Object.freeze([
  { id: '2d', label: '2D', title: 'The 2D editor (opens on the tab you used last)' },
  { id: '3d', label: '3D', title: 'The 3D view (keeps your edits, like Apply)' },
]);
export const VIEW_TOGGLE_HOSTS = Object.freeze([
  { host: 'previewArea', mode: '3d' }, // the main 3D viewport (top-left: the view cube is top-right)
  { host: 'editorCanvasContainer', mode: '2d' }, // the editor's canvas
]);

let _lastTab = null;

export function currentViewMode() { return isEditorOpen() ? '2d' : '3d'; }

/** Switch to `mode`; a no-op when already there. Returns the action taken (for tests / the matrix). */
export function setViewMode(mode) {
  if (mode === currentViewMode()) return 'none';
  if (mode === '2d') {
    openEditorOn(_lastTab || getEditorTab() || 'artwork');
    return 'open';
  }
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const unchanged = !editor?._editingTextEl && SvgEditorSnapshot.fingerprint != null
    && SvgEditorSnapshot.fingerprint === editorSessionFingerprint();
  if (unchanged) { closeEditorUnchanged(); return 'close'; }
  document.getElementById('editorApply')?.click(); // the Apply way, exactly
  return 'apply';
}

function renderPill(hostEl, activeMode) {
  const pill = document.createElement('div');
  pill.className = 'view-mode-toggle';
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', '2D / 3D view');
  pill.style.cssText = 'position:absolute; top:10px; left:10px; z-index:120; display:flex; border-radius:14px; overflow:hidden;'
    + ' border:1px solid rgba(0,0,0,0.2); box-shadow:0 1px 4px rgba(0,0,0,0.18); background:#fff; font:600 11px sans-serif;';
  for (const m of VIEW_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `viewMode_${m.id}${activeMode === '2d' ? '_editor' : ''}`;
    b.textContent = m.label;
    b.title = m.title;
    const on = m.id === activeMode;
    b.setAttribute('aria-pressed', String(on));
    b.style.cssText = `border:none; padding:5px 12px; cursor:${on ? 'default' : 'pointer'};`
      + (on ? ' background:var(--cad-accent-blue, #0078d4); color:#fff;' : ' background:#fff; color:#444;');
    b.addEventListener('click', () => setViewMode(m.id));
    pill.appendChild(b);
  }
  hostEl.appendChild(pill);
}

export function initViewModeToggle() {
  for (const { host, mode } of VIEW_TOGGLE_HOSTS) {
    const el = document.getElementById(host);
    if (el && !el.querySelector('.view-mode-toggle')) renderPill(el, mode);
  }
  // the last-used editor tab: whichever the editor was last switched to
  document.addEventListener('editorTabChanged', (e) => { if (e.detail?.tab) _lastTab = e.detail.tab; });
}
