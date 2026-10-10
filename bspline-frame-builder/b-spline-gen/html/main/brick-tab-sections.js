/**
 * brick-tab-sections.js -- Fred (2026-10-07, Brick-tab mockup v2: "Yes, build it"; "organise the params into actual
 * sections"; "color coded"; "sections are unique"): each Brick-editor tab shows its settings as its OWN foldable,
 * colour-coded sections, declared once here.
 *
 * BRICK_TAB_SECTIONS: per tab (the Brick tab strip's ids: 'general' + the tool ids), the sections in reading order --
 * a title (unique within the tab), a KIND (its colour, section-themes.js BRICK_SECTION_THEMES: one kind = one colour in
 * every tab) and the rows (element ids) it holds. A row lives in exactly one tab, except SHARED_ROWS -- the per-element
 * rows every element tab shows (the set, the joint width): one DOM node, moved into the active tab's section on each
 * tab switch. `titleOf` names the label the section's title replaces (hidden). A section whose rows are all hidden
 * (e.g. Corners on a band-less frame) hides too, so no title ever stands over an empty body.
 */
import { themeBrickSection } from './section-themes.js';

const sec = (id, title, kind, rows, extra = {}) => Object.freeze({ id, title, kind, rows: Object.freeze(rows), ...extra });
const JOINT = ['brickGroutWidthRow', 'brickGroutSpacingHint'];

export const BRICK_TAB_SECTIONS = Object.freeze({
  general: Object.freeze({ host: 'brickSharedLayout', after: null, sections: Object.freeze([
    sec('size', 'Brick size (in)', 'brick-size', ['brickSizeBlock'], { titleOf: 'brickSizeLabel' }),
    sec('look', 'Look · every element', 'brick-look', ['brickGroutPaintRow']),
    sec('crumble', 'Crumble', 'brick-crumble', ['brickSuppressionRow', 'brickClumpingRow', 'brickTopBiasRow']),
    sec('random', 'Randomness', 'brick-random', ['brickSeedRow']),
  ]) }),
  wall: Object.freeze({ host: 'brickWallSection', after: 'brickWallAreaHint', sections: Object.freeze([
    sec('bricks', 'Bricks', 'brick-bricks', ['brickSharedSet']),
    sec('pattern', 'Pattern', 'brick-pattern', ['brickWallPatternRow', 'brickWallRotationRow', 'brickLargeStonesRow'], { titleOf: 'brickWallPatternLabel' }),
    sec('accent', 'Accent relief', 'brick-accent', ['brickWallAccentRow', 'brickAccentActionsRow', 'brickPatternBuilder', 'brickAccentLevelRow'], { titleOf: 'brickWallAccentLabel' }),
    sec('height', 'Height', 'brick-height', ['brickRusticRow_wall', 'brickLevelRow_wall']),
    sec('joint', 'Joint', 'brick-joint', JOINT),
  ]) }),
  frame: Object.freeze({ host: 'brickFrameSection', after: 'brickElementLabel_frame', sections: Object.freeze([
    sec('bricks', 'Bricks', 'brick-bricks', ['brickSharedSet']),
    sec('bands', 'Bands', 'brick-pattern', ['brickFramePresetRow', 'brickFrameOffsetRow', 'brickFrameBandsNoteRow', 'brickFrameBandPatternRow']), // + Offset from frame (where the bands start)
    sec('corners', 'Corners', 'brick-corners', ['brickFrameCornerRow', 'brickFrameFanCentreRow'], { titleOf: 'brickFrameCornerLabel' }), // + T86 item 16e
    sec('height', 'Height', 'brick-height', ['brickLevelRow_frame']),
    // item 9 (Fred: the frame crumbles by the wall's rule; the inset window's brick surround)
    sec('crumble', 'Crumble', 'brick-crumble', ['brickFrameCrumbleRow']),
    sec('surround', 'Window surround', 'brick-surround', ['brickWindowSurroundRow'], { titleOf: 'brickSurroundLabel' }),
    sec('joint', 'Joint', 'brick-joint', JOINT),
  ]) }),
  brush: Object.freeze({ host: 'brickBrushSection', after: 'brickElementLabel_brush', sections: Object.freeze([
    sec('bricks', 'Bricks', 'brick-bricks', ['brickSharedSet']),
    sec('stroke', 'Stroke', 'brick-pattern', ['brickBrushProfileRow', 'brickBrushOrientationRow', 'brickBrushPresetRow']),
    sec('accent', 'Accent relief', 'brick-accent', ['brickBrushAccentRow']),
    sec('height', 'Height', 'brick-height', ['brickRusticRow_brush']),
    sec('joint', 'Joint', 'brick-joint', JOINT),
  ]) }),
  raisedBrush: Object.freeze({ host: 'brickRaisedSection', after: 'brickElementLabel_raisedBrush', sections: Object.freeze([
    sec('bricks', 'Bricks', 'brick-bricks', ['brickSharedSet']),
    sec('mode', 'Mode', 'brick-pattern', ['brickRaisedModeRow'], { titleOf: 'brickRaisedModeLabel' }),
    sec('height', 'Height', 'brick-height', ['brickRaisedLevelRow']),
    sec('joint', 'Joint', 'brick-joint', JOINT),
  ]) }),
});

/** The rows more than one tab declares (derived, never typed): moved into the active tab's section on a tab switch. */
export const SHARED_ROWS = Object.freeze((() => {
  const seen = new Map();
  for (const def of Object.values(BRICK_TAB_SECTIONS)) for (const s of def.sections) for (const r of s.rows) seen.set(r, (seen.get(r) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([r]) => r);
})());

/** Which sections are open is remembered per device -- the SAME store as the main sidebar's sections (the palette's
 *  PANEL_OPEN_KEY), keyed by the section's own `panel-<key>` class. */
export const BRICK_SECTION_OPEN_KEY = 'bspline.sidebar.openPanels';

export const sectionDomId = (tab, id) => `brickSec_${tab}_${id}`;
const panelKey = (tab, id) => `panel-bricksec-${tab}-${id}`;

const _state = { doc: null, active: null, missing: [], observer: null, syncing: false };

function _readOpen() {
  try { return JSON.parse(localStorage.getItem(BRICK_SECTION_OPEN_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function _setOpen(shell, open) {
  shell.querySelector(':scope > .panel-header').classList.toggle('collapsed', !open);
  shell.querySelector(':scope > .panel-body').classList.toggle('hidden', !open);
}
function _toggle(shell) {
  const open = shell.querySelector(':scope > .panel-body').classList.contains('hidden');
  _setOpen(shell, open);
  try {
    const saved = _readOpen();
    saved[panelKey(shell.dataset.brickTab, shell.dataset.brickSection)] = open;
    localStorage.setItem(BRICK_SECTION_OPEN_KEY, JSON.stringify(saved));
  } catch (_) { /* storage unavailable: nothing remembered */ }
}

function _build(doc) {
  const missing = [];
  const saved = _readOpen();
  for (const [tab, def] of Object.entries(BRICK_TAB_SECTIONS)) {
    const host = doc.getElementById(def.host);
    if (!host) { missing.push(def.host); continue; }
    let anchor = def.after ? doc.getElementById(def.after) : null;
    if (anchor && anchor.parentNode !== host) anchor = null;
    for (const s of def.sections) {
      const shell = doc.createElement('div');
      shell.id = sectionDomId(tab, s.id);
      shell.className = `panel brick-sec ${panelKey(tab, s.id)}`;
      shell.dataset.brickTab = tab;
      shell.dataset.brickSection = s.id;
      shell.dataset.kind = s.kind;
      const head = doc.createElement('div');
      head.className = 'panel-header';
      head.textContent = s.title;
      head.addEventListener('click', () => _toggle(shell));
      const body = doc.createElement('div');
      body.className = 'panel-body';
      shell.append(head, body);
      if (anchor) anchor.after(shell); else host.prepend(shell);
      anchor = shell;
      for (const r of s.rows) {
        const row = doc.getElementById(r);
        if (!row) { missing.push(r); continue; }
        if (!row.closest('.brick-sec')) body.appendChild(row); // a shared row parks in the first tab declaring it
      }
      if (s.titleOf) doc.getElementById(s.titleOf)?.classList.add('brick-sec-title-label');
      themeBrickSection(shell, s.kind);
      const key = panelKey(tab, s.id);
      if (typeof saved[key] === 'boolean') _setOpen(shell, saved[key]);
    }
  }
  return missing;
}

const _isHidden = (el) => el.style.display === 'none' || el.classList.contains('hidden') || el.classList.contains('brick-sec-title-label');
/** A row counts as shown when it is not hidden itself and, if it has element children, at least one of them shows. */
function _rowShown(el) {
  if (_isHidden(el)) return false;
  const kids = [...el.children];
  return kids.length === 0 || kids.some((k) => !_isHidden(k));
}

/** Each section shows only in its own tab, and only while at least one of its rows shows. */
export function syncBrickSectionVisibility(doc = _state.doc) {
  if (!doc) return;
  _state.syncing = true;
  try {
    for (const [tab, def] of Object.entries(BRICK_TAB_SECTIONS)) {
      for (const s of def.sections) {
        const shell = doc.getElementById(sectionDomId(tab, s.id));
        if (!shell) continue;
        const body = shell.querySelector(':scope > .panel-body');
        const show = tab === _state.active && [...body.children].some(_rowShown);
        const want = show ? '' : 'none';
        if (shell.style.display !== want) shell.style.display = want;
      }
    }
  } finally {
    _state.syncing = false;
  }
}

/** Show tab `tabKey`'s sections ('general' or a tool id; a tool without sections shows none): builds them once per
 *  document, moves the shared rows into the active tab's sections, then syncs which sections show. Returns the
 *  declared rows/hosts missing from the page (empty when the page matches the declaration). */
export function applyBrickTabSections(tabKey, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return [];
  if (_state.doc !== doc || !doc.querySelector('.brick-sec')) {
    _state.doc = doc;
    _state.missing = _build(doc);
    if (_state.observer) _state.observer.disconnect();
    const root = doc.getElementById('editorBrickPanel');
    if (root && typeof MutationObserver !== 'undefined') {
      // a row shown / hidden by its own sync (Corners, Rustic, Large stones...) re-decides its section
      _state.observer = new MutationObserver(() => { if (!_state.syncing) syncBrickSectionVisibility(doc); });
      _state.observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
  }
  _state.active = tabKey;
  const def = BRICK_TAB_SECTIONS[tabKey];
  if (def) {
    for (const s of def.sections) {
      const body = doc.getElementById(sectionDomId(tabKey, s.id))?.querySelector(':scope > .panel-body');
      if (!body) continue;
      for (const r of s.rows) if (SHARED_ROWS.includes(r)) { const row = doc.getElementById(r); if (row) body.appendChild(row); }
    }
  }
  syncBrickSectionVisibility(doc);
  return _state.missing;
}

/** The tab a control's section belongs to ('general' / a tool id), or null when the control sits in no section. */
export function brickTabOfControl(el) {
  const shell = el && el.closest ? el.closest('.brick-sec') : null;
  return shell ? shell.dataset.brickTab : null;
}
