/**
 * sidebar-tabs.js -- the main sidebar's TREE (redesign phase 5, seat D's mockups shots/seatD/redesign/mock_Sidebar_*):
 * the former tabs are BRANCHES of one collapse tree (▾ BOARD, its sections under it, then ▾ SURFACE ...), each
 * folding on its own, Generate New Seed pinned above them. Before it (F35 item 48) they were tabs, one shown at a time.
 * Item 47's PIN stays: a pinned section sits at the top, under the seed bar, whatever is folded.
 *
 * SIDEBAR_TABS declares the branches and which section (.panel.<class>) sits in which; a section no branch lists falls
 * into SIDEBAR_UNLISTED_TAB, so a new panel never vanishes. A branch's label keeps the old tab's id (sidebarTab_<id>):
 * tapping it opens that branch and scrolls to it (the brick matrix and the phone audits drive those ids); its caret
 * folds / unfolds. Which branches are open and the pinned set persist per device (localStorage, try/catch: blocked
 * storage starts on SIDEBAR_DEFAULT_OPEN with nothing pinned).
 */
// A branch's ORDER on screen is declared, never the page's markup order: its own `sections`, then each of its `groups`
// (a sub-heading inside the branch with its own sections). Fred 2026-10-11 (final): three branches; Surface holds the
// sections edited in place, then a "2D editor" group with the ones that open the 2D editor (Photo, Brick, Vector
// stamping -- Decor's two joined Photo there).
export const SIDEBAR_TABS = Object.freeze([
  Object.freeze({ id: 'board', label: 'Board', sections: Object.freeze(['panel-stock', 'panel-frame']) }),
  Object.freeze({ id: 'surface', label: 'Surface', sections: Object.freeze(['panel-skeleton', 'panel-filter', 'panel-sculpt-top', 'panel-thicken', 'panel-sculpt-bot']),
    groups: Object.freeze([Object.freeze({ id: 'editor', label: '2D editor', sections: Object.freeze(['panel-photo', 'panel-brick', 'panel-stamp']) })]) }),
  Object.freeze({ id: 'output', label: 'Output', sections: Object.freeze(['panel-view', 'panel-export', 'panel-resolution']) }),
]);
/** Pure: every section of a branch in its order on screen (its own, then each group's). */
export const branchSections = (t) => [...t.sections, ...(t.groups || []).flatMap((g) => g.sections)];
/** Pure: the group (within its branch) a section key sits in, or null. */
export const groupOfSection = (key) => SIDEBAR_TABS.flatMap((t) => t.groups || []).find((g) => g.sections.includes(key)) || null;
// a retired branch id -> where it lives now (setSidebarTab, a device's saved open set, the old tab key): Decor is
// Surface, scrolled to its 2D editor group
export const SIDEBAR_TAB_ALIASES = Object.freeze({ decor: Object.freeze({ tab: 'surface', group: 'editor' }) });
export const SIDEBAR_UNLISTED_TAB = 'surface';
// the mockup's first look: Board and Surface open, Output folded
export const SIDEBAR_DEFAULT_OPEN = Object.freeze(['board', 'surface']);
export const SIDEBAR_OPEN_STORAGE_KEY = 'bspline.main.sidebarOpen';
export const SIDEBAR_PINNED_STORAGE_KEY = 'bspline.main.sidebarPinned';
// the tab a viewer last had (the tab strip's key, read once): on a device with no tree state yet it opens too
export const SIDEBAR_LEGACY_TAB_STORAGE_KEY = 'bspline.main.sidebarTab';
export const PIN_TITLE = { pin: 'Pin to the top (shown whatever is folded)', unpin: 'Unpin' };
export const BRANCH_CARET = { open: '▾', folded: '▸' };

/** Pure: the section's own class (panel-xxx) of a .panel element's class list. */
export function sectionKey(classList) {
  return [...classList].find((c) => c.startsWith('panel-') && c !== 'panel-body' && c !== 'panel-header') || null;
}

/** Pure: the branch a section key belongs to (declared, else SIDEBAR_UNLISTED_TAB). */
export function tabOfSection(key) {
  const tab = SIDEBAR_TABS.find((t) => branchSections(t).includes(key));
  return tab ? tab.id : SIDEBAR_UNLISTED_TAB;
}

/** Pure: is a section on screen, given the open branches and the pinned keys? A pinned one always is. */
export function isSectionShown(key, open, pinned) {
  return pinned.includes(key) || open.includes(tabOfSection(key));
}

/** Pure: a branch id as it is now (a retired one through SIDEBAR_TAB_ALIASES). */
export const branchOf = (id) => (SIDEBAR_TAB_ALIASES[id] ? SIDEBAR_TAB_ALIASES[id].tab : id);

/** Pure: the open branches a device starts with -- its saved set, else the default plus the tab it last had (a retired
 *  id in either read as the branch it became). */
export function initialOpenBranches(saved, legacyTab) {
  const ids = SIDEBAR_TABS.map((t) => t.id);
  if (Array.isArray(saved)) { const now = saved.map(branchOf); return ids.filter((id) => now.includes(id)); }
  return ids.filter((id) => SIDEBAR_DEFAULT_OPEN.includes(id) || id === branchOf(legacyTab));
}

/** Pure: the sections' order on screen -- each branch's declared `sections`, branch by branch; a section none lists
 *  after its branch's declared ones, in `pageOrder`. */
export function declaredSectionOrder(keys) {
  const rank = (k) => {
    const b = SIDEBAR_TABS.findIndex((t) => t.id === tabOfSection(k)), i = branchSections(SIDEBAR_TABS[b]).indexOf(k);
    return b * 1000 + (i < 0 ? 999 : i);
  };
  return keys.map((k, n) => [k, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([k]) => k);
}

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable: not remembered */ } };

let _state = null;

export function initSidebarTabs(doc = document) {
  const sections = doc.querySelector('.cad-sidebar .cad-sidebar-sections');
  if (!sections) return null;
  const panels = [...sections.querySelectorAll(':scope > .panel')].filter((p) => sectionKey(p.classList));
  const savedPinned = read(SIDEBAR_PINNED_STORAGE_KEY, []);
  _state = {
    open: initialOpenBranches(read(SIDEBAR_OPEN_STORAGE_KEY, null), read(SIDEBAR_LEGACY_TAB_STORAGE_KEY, null)),
    pinned: Array.isArray(savedPinned) ? savedPinned.filter((k) => panels.some((p) => sectionKey(p.classList) === k)) : [],
    panels, sections, branches: new Map(),
  };

  const pinnedBox = doc.createElement('div');
  pinnedBox.id = 'sidebarPinned';
  sections.insertBefore(pinnedBox, sections.firstChild);
  _state.pinnedBox = pinnedBox;

  for (const t of SIDEBAR_TABS) {
    const branch = doc.createElement('div');
    branch.className = 'sidebar-branch';
    branch.dataset.branch = t.id;
    const head = doc.createElement('div');
    head.className = 'sidebar-branch-head';
    const caret = doc.createElement('button');
    caret.type = 'button';
    caret.className = 'sidebar-branch-caret';
    caret.setAttribute('aria-controls', `sidebarBranch_${t.id}`);
    caret.addEventListener('click', () => toggleSidebarBranch(t.id));
    const label = doc.createElement('button');
    label.type = 'button';
    label.className = 'sidebar-branch-label';
    label.id = `sidebarTab_${t.id}`; // the former tab's id: open + scroll
    label.textContent = t.label;
    label.addEventListener('click', () => setSidebarTab(t.id));
    head.append(caret, label);
    const body = doc.createElement('div');
    body.className = 'sidebar-branch-body';
    body.id = `sidebarBranch_${t.id}`;
    // each group: its heading, then its sections (placed by apply), after the branch's own sections
    const groups = new Map();
    for (const g of t.groups || []) {
      const box = doc.createElement('div');
      box.className = 'sidebar-group';
      box.id = `sidebarGroup_${g.id}`;
      const gh = doc.createElement('div');
      gh.className = 'sidebar-group-head';
      gh.textContent = g.label;
      box.append(gh);
      groups.set(g.id, box);
    }
    branch.append(head, body);
    sections.appendChild(branch);
    _state.branches.set(t.id, { branch, head, caret, label, body, groups });
  }

  for (const p of panels) {
    const header = p.querySelector(':scope > .panel-header');
    if (!header) continue;
    const key = sectionKey(p.classList);
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
  // every section in its place, in the declared order (pinned at the top, the rest in their branch)
  const byKey = new Map(s.panels.map((p) => [sectionKey(p.classList), p]));
  for (const key of declaredSectionOrder([...byKey.keys()])) {
    const p = byKey.get(key);
    const pinned = s.pinned.includes(key);
    const b = s.branches.get(tabOfSection(key)), g = groupOfSection(key);
    (pinned ? s.pinnedBox : g ? b.groups.get(g.id) : b.body).appendChild(p);
    const pin = p.querySelector(':scope > .panel-header > .panel-pin');
    if (pin) {
      pin.classList.toggle('pinned', pinned);
      pin.title = pinned ? PIN_TITLE.unpin : PIN_TITLE.pin;
      pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    }
  }
  for (const t of SIDEBAR_TABS) {
    const b = s.branches.get(t.id), open = s.open.includes(t.id);
    // a group after the branch's own sections; shown while it holds a section (all pinned away: its heading goes too)
    for (const box of b.groups.values()) { b.body.appendChild(box); box.hidden = box.children.length < 2; }
    b.body.hidden = !open;
    b.branch.classList.toggle('open', open);
    b.caret.textContent = open ? BRANCH_CARET.open : BRANCH_CARET.folded;
    b.caret.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.caret.setAttribute('aria-label', `${open ? 'Fold' : 'Unfold'} ${t.label}`);
    b.label.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

function setOpen(id, open) {
  const s = _state;
  s.open = SIDEBAR_TABS.map((t) => t.id).filter((x) => (x === id ? open : s.open.includes(x)));
  write(SIDEBAR_OPEN_STORAGE_KEY, s.open);
  apply();
}

/** A branch's caret: fold it if open, unfold it if folded. */
export function toggleSidebarBranch(id) {
  if (!_state || !_state.branches.has(id)) return;
  setOpen(id, !_state.open.includes(id));
}

/** A branch's label (the former tab, sidebarTab_<id>): that branch opens -- never folds -- and scrolls into view. A
 *  retired id (SIDEBAR_TAB_ALIASES) opens the branch it became and scrolls to its group. */
export function setSidebarTab(id) {
  const alias = SIDEBAR_TAB_ALIASES[id], tab = branchOf(id);
  if (!_state || !_state.branches.has(tab)) return;
  if (!_state.open.includes(tab)) setOpen(tab, true);
  const b = _state.branches.get(tab);
  const group = alias && alias.group && b.groups.get(alias.group);
  const target = (group && !group.hidden && group) || b.head;
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
}

export function toggleSidebarPin(key) {
  if (!_state) return;
  const s = _state;
  s.pinned = s.pinned.includes(key) ? s.pinned.filter((k) => k !== key) : [...s.pinned, key];
  write(SIDEBAR_PINNED_STORAGE_KEY, s.pinned);
  apply();
}

/** Sends the user (or a test) to a section: its branch opens (a pinned section is always shown) and, if folded, the
 *  section unfolds (its header's own togglePanel). */
export function revealSidebarSection(key, doc = document) {
  if (!_state) return false;
  if (!_state.pinned.includes(key) && !_state.open.includes(tabOfSection(key))) setOpen(tabOfSection(key), true);
  const header = doc.querySelector(`.cad-sidebar .panel.${key} > .panel-header`);
  if (header && header.classList.contains('collapsed')) {
    // the palette's own global (the header's inline onclick); a click where it is absent
    if (typeof window !== 'undefined' && typeof window.togglePanel === 'function') window.togglePanel(header); else header.click();
  }
  return true;
}

export const sidebarTabState = () => (_state ? { open: [..._state.open], pinned: [..._state.pinned] } : null);
