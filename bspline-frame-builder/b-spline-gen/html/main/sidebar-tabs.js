/**
 * sidebar-tabs.js -- F35 item 48 (main sidebar TABS) + item 47 (PIN a section to the top), Fred's OK on mockup v2:
 * the tab strip is the first thing in the sidebar (pinned with Generate New Seed under it), then the PINNED sections
 * (shown on every tab), then the active tab's own sections.
 *
 * SIDEBAR_TABS declares which section (.panel.<class>) sits in which tab; a section no tab lists falls into
 * SIDEBAR_UNLISTED_TAB, so a new panel never vanishes. The active tab and the pinned set persist per viewer
 * (localStorage, try/catch: a blocked storage just starts on the default tab with nothing pinned).
 */
import { renderTabStrip } from '../editor/tab-strip.js';

export const SIDEBAR_TABS = Object.freeze([
  Object.freeze({ id: 'board', label: 'Board', sections: Object.freeze(['panel-stock', 'panel-frame']) }),
  Object.freeze({ id: 'surface', label: 'Surface', sections: Object.freeze(['panel-skeleton', 'panel-filter', 'panel-sculpt-top', 'panel-thicken', 'panel-sculpt-bot']) }),
  Object.freeze({ id: 'decor', label: 'Decor', sections: Object.freeze(['panel-brick', 'panel-stamp']) }),
  Object.freeze({ id: 'output', label: 'Output', sections: Object.freeze(['panel-view', 'panel-export', 'panel-resolution']) }),
]);
export const SIDEBAR_DEFAULT_TAB = 'board';
export const SIDEBAR_UNLISTED_TAB = 'decor';
export const SIDEBAR_TAB_STORAGE_KEY = 'bspline.main.sidebarTab';
export const SIDEBAR_PINNED_STORAGE_KEY = 'bspline.main.sidebarPinned';
export const PIN_TITLE = { pin: 'Pin to the top (shown on every tab)', unpin: 'Unpin' };

/** Pure: the section's own class (panel-xxx) of a .panel element's class list. */
export function sectionKey(classList) {
  return [...classList].find((c) => c.startsWith('panel-') && c !== 'panel-body' && c !== 'panel-header') || null;
}

/** Pure: the tab a section key belongs to (declared, else SIDEBAR_UNLISTED_TAB). */
export function tabOfSection(key) {
  const tab = SIDEBAR_TABS.find((t) => t.sections.includes(key));
  return tab ? tab.id : SIDEBAR_UNLISTED_TAB;
}

/** Pure: is a section shown with `activeTab` on, given the pinned keys? Pinned ones always are. */
export function isSectionShown(key, activeTab, pinned) {
  return pinned.includes(key) || tabOfSection(key) === activeTab;
}

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable: not remembered */ } };

let _state = null;

export function initSidebarTabs(doc = document) {
  const sections = doc.querySelector('.cad-sidebar .cad-sidebar-sections');
  const actions = doc.querySelector('.cad-sidebar > .sticky-actions');
  if (!sections || !actions) return null;
  const panels = [...sections.querySelectorAll(':scope > .panel')].filter((p) => sectionKey(p.classList));
  const savedTab = read(SIDEBAR_TAB_STORAGE_KEY, SIDEBAR_DEFAULT_TAB);
  const savedPinned = read(SIDEBAR_PINNED_STORAGE_KEY, []);
  _state = {
    active: SIDEBAR_TABS.some((t) => t.id === savedTab) ? savedTab : SIDEBAR_DEFAULT_TAB,
    pinned: Array.isArray(savedPinned) ? savedPinned.filter((k) => panels.some((p) => sectionKey(p.classList) === k)) : [],
    panels, sections, anchors: new Map(), sync: null,
  };

  const strip = doc.createElement('div');
  strip.id = 'sidebarTabs';
  actions.insertBefore(strip, actions.firstChild);
  _state.sync = renderTabStrip(strip, SIDEBAR_TABS, setSidebarTab, { idPrefix: 'sidebarTab_' });

  const pinnedBox = doc.createElement('div');
  pinnedBox.id = 'sidebarPinned';
  sections.insertBefore(pinnedBox, sections.firstChild);
  _state.pinnedBox = pinnedBox;

  for (const p of panels) {
    const key = sectionKey(p.classList);
    // where the section goes back to when unpinned
    const anchor = doc.createComment(`sidebar-pin-anchor:${key}`);
    p.parentNode.insertBefore(anchor, p);
    _state.anchors.set(key, anchor);
    const header = p.querySelector(':scope > .panel-header');
    if (!header) continue;
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '6px';
    const pin = doc.createElement('button');
    pin.type = 'button';
    pin.className = 'panel-pin';
    pin.dataset.section = key;
    pin.textContent = '📌';
    pin.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebarPin(key); });
    header.appendChild(pin);
  }
  apply();
  return _state;
}

function apply() {
  const s = _state;
  for (const p of s.panels) {
    const key = sectionKey(p.classList);
    const pinned = s.pinned.includes(key);
    if (pinned && p.parentNode !== s.pinnedBox) s.pinnedBox.appendChild(p);
    if (!pinned && p.parentNode === s.pinnedBox) { const a = s.anchors.get(key); a.parentNode.insertBefore(p, a.nextSibling); }
    p.style.display = isSectionShown(key, s.active, s.pinned) ? '' : 'none';
    const pin = p.querySelector(':scope > .panel-header > .panel-pin');
    if (pin) {
      pin.classList.toggle('pinned', pinned);
      pin.title = pinned ? PIN_TITLE.unpin : PIN_TITLE.pin;
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
  }
  // pinned sections keep the declared reading order (SIDEBAR_TABS, then panel order)
  const order = (key) => s.panels.findIndex((p) => sectionKey(p.classList) === key);
  [...s.pinnedBox.children].sort((a, b) => order(sectionKey(a.classList)) - order(sectionKey(b.classList))).forEach((p) => s.pinnedBox.appendChild(p));
  s.sync(s.active);
}

export function setSidebarTab(id) {
  if (!_state || !SIDEBAR_TABS.some((t) => t.id === id)) return;
  _state.active = id;
  write(SIDEBAR_TAB_STORAGE_KEY, id);
  apply();
}

export function toggleSidebarPin(key) {
  if (!_state) return;
  const s = _state;
  s.pinned = s.pinned.includes(key) ? s.pinned.filter((k) => k !== key) : [...s.pinned, key];
  write(SIDEBAR_PINNED_STORAGE_KEY, s.pinned);
  apply();
}

/** Sends the user (or a test) to a section: its tab becomes the active one (a pinned section shows on every tab) and,
 *  if folded, it unfolds (its header's own togglePanel). */
export function revealSidebarSection(key, doc = document) {
  if (!_state) return false;
  if (!_state.pinned.includes(key)) setSidebarTab(tabOfSection(key));
  const header = doc.querySelector(`.cad-sidebar .panel.${key} > .panel-header`);
  if (header && header.classList.contains('collapsed')) {
    // the palette's own global (the header's inline onclick); a click where it is absent
    if (typeof window !== 'undefined' && typeof window.togglePanel === 'function') window.togglePanel(header); else header.click();
  }
  return true;
}

export const sidebarTabState = () => (_state ? { active: _state.active, pinned: [..._state.pinned] } : null);
