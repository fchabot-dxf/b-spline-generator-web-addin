/**
 * main/icon-select.js -- an ICON DROPDOWN over an existing <select> (advisor turn 203, Fred's rule: a long
 * visual list shows icons only, the name as a tooltip). The <select> stays the single source of truth (its
 * value, its options, its own 'change' listeners, every test that reads it): the select is hidden and a
 * button showing the current option's icon opens a grid of icon-only buttons; a pick sets the select's
 * value and dispatches 'change' exactly as a native pick would. Options are re-read from the select on every
 * open (so options added later -- e.g. a hidden template's own current record -- appear too).
 *   mountIconSelect(select, { iconFor(value) -> svg markup | null, label, optionId, pickSame })
 *     optionId(value) -> id: each grid item carries that id, and the grid is built at mount and kept (the items exist
 *       for code that addresses them by id -- the sidebar Brick rows' brickQuick_<row>_<choice>; their active /
 *       disabled state stays on them). Without it the grid is rebuilt on every open, as before.
 *     tilePx / columns: the grid's tile size and column count -- by default PICKER_TILE, the ONE declaration every picker
 *       shares; columns may be { phone, desktop } (phone below PHONE_MAX_PX of viewport width), read on every open.
 *   The chosen option's NAME shows with the chip (.icon-select-name: beside it, wrapping BELOW it in a narrow sidebar);
 *   the tooltip stays.
 *     pickSame: a pick of the CURRENT option still dispatches 'change' (a Frame-bands pick lays the frame even when
 *       the preset is already the chosen one).
 *   refreshIconSelect(select) -- after code sets select.value directly (no 'change' event fires then)
 */
const MOUNTED = new WeakMap(); // select -> { button, iconFor }
/** The OPEN pickers only: ONE document click / scroll listener closes them (seat D, measured: a listener pair per mount
 *  kept every re-rendered picker -- its kept grid of tile icons -- alive; 107 panel re-inits ran a test worker out of
 *  memory). A closed or detached picker is referenced by nothing global. */
const _open = new Set();
let _globalWired = false;
function _wireGlobal() {
  if (_globalWired || typeof document === 'undefined') return;
  _globalWired = true;
  document.addEventListener('click', (e) => { for (const p of [..._open]) if (!p.wrap.contains(e.target)) p.close(); });
  // a fixed grid would float away from its button: any scroll closes it
  window.addEventListener('scroll', (e) => { for (const p of [..._open]) if (!p.grid.contains(e.target)) p.close(); }, true);
}

function _iconHtml(iconFor, value, text) {
  const svg = iconFor(value);
  return svg || `<span style="font-size:10px; padding:0 4px;">${text}</span>`;
}

export function refreshIconSelect(select) {
  const m = select && MOUNTED.get(select);
  if (!m) return;
  const opt = select.options[select.selectedIndex];
  m.button.innerHTML = _iconHtml(m.iconFor, select.value, opt ? opt.textContent : '');
  // the chip shows the pick at the CHIP size (a tile icon is drawn for the grid's bigger tiles; measured live, a 72 px
  // icon overflowed the 40 px chip and covered the row's label)
  const svg = m.button.querySelector('svg');
  if (svg) { svg.setAttribute('width', PICKER_TILE.chipPx - 6); svg.setAttribute('height', PICKER_TILE.chipPx - 6); }
  m.button.title = `${m.label}: ${opt ? opt.textContent : ''}`;
  if (m.name) m.name.textContent = opt ? opt.textContent : '';
}

/** Below this viewport width a picker declared with { phone, desktop } columns uses its phone count. */
export const PHONE_MAX_PX = 600;
/** Fred (2026-10-11, the redesign): every picker's grid -- bigger tiles than the first 40 px (the frame preset list may
 *  double with corner variants; the corner, the motif and a template's shape must read), 3 columns on a phone, 4 on a
 *  desktop. Board > Frame's template, the editor Frame tab's, the sidebar Brick rows: all read this. */
export const PICKER_TILE = Object.freeze({ tilePx: 80, columns: Object.freeze({ phone: 3, desktop: 4 }), chipPx: 40 });
export function mountIconSelect(select, { iconFor, label = '', optionId = null, pickSame = false, tilePx = PICKER_TILE.tilePx, columns = PICKER_TILE.columns }) {
  if (!select || MOUNTED.has(select)) return null;
  const wrap = document.createElement('div');
  wrap.className = 'icon-select';
  wrap.style.cssText = 'position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px;';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cad-btn icon-select-button';
  button.style.cssText = `display:flex; align-items:center; justify-content:center; min-width:${PICKER_TILE.chipPx}px; height:${PICKER_TILE.chipPx}px; padding:2px; overflow:hidden;`;
  const grid = document.createElement('div');
  grid.className = 'icon-select-grid';
  grid.setAttribute('role', 'listbox');
  // position:fixed, placed under the button on open: the sidebar's picker sits in a .cad-nested-input
  // (overflow:hidden), which CLIPPED an absolutely positioned grid -- the list was invisible there (turn 207)
  grid.style.cssText = 'display:none; position:fixed; z-index:10001; background:#fff; border:1px solid #ccc;'
    + ' border-radius:4px; padding:4px; box-shadow:0 2px 8px rgba(0,0,0,0.15); gap:4px;'
    + ' width:max-content;'; // 4 x 40 px fits the 236 px side panels (measured live: 5 auto columns overflowed it)
  const name = document.createElement('span');
  name.className = 'icon-select-name';
  name.style.cssText = 'flex:1 1 110px; min-width:0; font-size:12px; opacity:0.85;'; // wraps under the chip when narrow
  wrap.append(button, name, grid);
  select.style.display = 'none';
  // a select inside a .cad-nested-input (the sidebar's: a 24 px box, overflow hidden) would clip the 40 px
  // button -- the dropdown goes AFTER that box, which hides with its select (turn 207)
  const host = select.closest('.cad-nested-input') || select;
  if (host !== select) { wrap.style.marginBottom = host.style.marginBottom; host.style.display = 'none'; }
  host.insertAdjacentElement('afterend', wrap);
  MOUNTED.set(select, { button, iconFor, label, name });

  const entry = { wrap, grid, close: () => { grid.style.display = 'none'; _open.delete(entry); } };
  const close = entry.close;
  const build = () => {
    grid.innerHTML = '';
    for (const opt of select.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cad-btn icon-select-option';
      b.dataset.value = opt.value;
      if (optionId) b.id = optionId(opt.value);
      b.title = opt.textContent; // icons only; the NAME is the tooltip
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', opt.textContent);
      b.style.cssText = `display:flex; align-items:center; justify-content:center; width:${tilePx}px; min-width:0; height:${tilePx}px; padding:2px; box-sizing:border-box;`;
      b.innerHTML = _iconHtml(iconFor, opt.value, opt.textContent);
      b.addEventListener('click', () => {
        close();
        if (select.value === opt.value && !pickSame) return;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refreshIconSelect(select);
      });
      grid.appendChild(b);
    }
  };
  const open = () => {
    if (!optionId) build(); // a kept grid (optionId) is built once, at mount
    for (const b of grid.children) b.style.outline = b.dataset.value === select.value ? '2px solid #0078d4' : '';
    const cols = typeof columns === 'number' ? columns : ((window.innerWidth || 1024) < PHONE_MAX_PX ? columns.phone : columns.desktop);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${tilePx}px)`;
    grid.style.display = 'grid';
    _open.add(entry);
    const r = button.getBoundingClientRect();
    const w = grid.getBoundingClientRect().width;
    grid.style.left = `${Math.max(4, Math.min(r.left, (window.innerWidth || r.left + w) - w - 4))}px`;
    grid.style.top = `${r.bottom}px`;
    // a long list (the wood frame's templates) never runs off the screen: the grid scrolls inside the room below the chip
    grid.style.maxHeight = `${Math.max(120, (window.innerHeight || 800) - r.bottom - 8)}px`;
    grid.style.overflowY = 'auto';
  };
  button.addEventListener('click', () => (grid.style.display === 'none' ? open() : close()));
  _wireGlobal();
  if (optionId) build();
  refreshIconSelect(select);
  return wrap;
}
