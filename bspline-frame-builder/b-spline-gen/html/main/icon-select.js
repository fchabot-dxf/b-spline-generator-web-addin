/**
 * main/icon-select.js -- an ICON DROPDOWN over an existing <select> (advisor turn 203, Fred's rule: a long
 * visual list shows icons only, the name as a tooltip). The <select> stays the single source of truth (its
 * value, its options, its own 'change' listeners, every test that reads it): the select is hidden and a
 * button showing the current option's icon opens a grid of icon-only buttons; a pick sets the select's
 * value and dispatches 'change' exactly as a native pick would. Options are re-read from the select on every
 * open (so options added later -- e.g. a hidden template's own current record -- appear too).
 *   mountIconSelect(select, { iconFor(value) -> svg markup | null, label })
 *   refreshIconSelect(select) -- after code sets select.value directly (no 'change' event fires then)
 */
const MOUNTED = new WeakMap(); // select -> { button, iconFor }

function _iconHtml(iconFor, value, text) {
  const svg = iconFor(value);
  return svg || `<span style="font-size:10px; padding:0 4px;">${text}</span>`;
}

export function refreshIconSelect(select) {
  const m = select && MOUNTED.get(select);
  if (!m) return;
  const opt = select.options[select.selectedIndex];
  m.button.innerHTML = _iconHtml(m.iconFor, select.value, opt ? opt.textContent : '');
  m.button.title = `${m.label}: ${opt ? opt.textContent : ''}`;
}

export function mountIconSelect(select, { iconFor, label = '' }) {
  if (!select || MOUNTED.has(select)) return null;
  const wrap = document.createElement('div');
  wrap.className = 'icon-select';
  wrap.style.cssText = 'position:relative; display:inline-block;';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cad-btn icon-select-button';
  button.style.cssText = 'display:flex; align-items:center; justify-content:center; min-width:40px; height:40px; padding:2px;';
  const grid = document.createElement('div');
  grid.className = 'icon-select-grid';
  grid.setAttribute('role', 'listbox');
  grid.style.cssText = 'display:none; position:absolute; z-index:10001; top:100%; left:0; background:#fff; border:1px solid #ccc;'
    + ' border-radius:4px; padding:4px; box-shadow:0 2px 8px rgba(0,0,0,0.15); grid-template-columns:repeat(4, 40px); gap:4px;'
    + ' width:max-content;'; // 4 x 40 px fits the 236 px side panels (measured live: 5 auto columns overflowed it)
  wrap.append(button, grid);
  select.style.display = 'none';
  select.insertAdjacentElement('afterend', wrap);
  MOUNTED.set(select, { button, iconFor, label });

  const close = () => { grid.style.display = 'none'; };
  const open = () => {
    grid.innerHTML = '';
    for (const opt of select.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cad-btn icon-select-option';
      b.dataset.value = opt.value;
      b.title = opt.textContent; // icons only; the NAME is the tooltip
      b.setAttribute('role', 'option');
      b.setAttribute('aria-label', opt.textContent);
      b.style.cssText = 'display:flex; align-items:center; justify-content:center; width:40px; min-width:0; height:40px; padding:2px; box-sizing:border-box;'
        + (opt.value === select.value ? ' outline:2px solid #0078d4;' : '');
      b.innerHTML = _iconHtml(iconFor, opt.value, opt.textContent);
      b.addEventListener('click', () => {
        close();
        if (select.value === opt.value) return;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refreshIconSelect(select);
      });
      grid.appendChild(b);
    }
    grid.style.display = 'grid';
  };
  button.addEventListener('click', () => (grid.style.display === 'none' ? open() : close()));
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  refreshIconSelect(select);
  return wrap;
}
