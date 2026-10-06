/**
 * tab-strip.js -- F35 items 43 / 48 + the Art / Photo tabs (Fred: "a tab system would work best", mockup v2: "the tabs
 * over the controls"): the ONE tab strip every right panel and the main sidebar head with. A strip is rendered from a
 * declared list of tabs ({ id, label, iconSvg?, title?, buttonId? }) and knows nothing about what a tab shows: the caller's onPick does
 * that. Styles: styles/layout-app.css `.ui-tab-strip` (variant `.ui-tab-strip--icons`: the icon above a small name,
 * for the narrow Brick panel, at most two rows at the default width).
 */

/** Renders `tabs` into `container` (emptied first) and returns `sync(activeId)`, which marks the active tab.
 *  `opts.variant`: 'text' (default) | 'icons'. `opts.idPrefix`: each button's id = idPrefix + tab.id (tests, matrix). */
export function renderTabStrip(container, tabs, onPick, { variant = 'text', idPrefix = '' } = {}) {
  if (!container) return () => {};
  container.textContent = '';
  container.classList.add('ui-tab-strip');
  container.classList.toggle('ui-tab-strip--icons', variant === 'icons');
  container.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-tab';
    b.setAttribute('role', 'tab');
    b.dataset.tab = tab.id;
    if (tab.buttonId) b.id = tab.buttonId; else if (idPrefix) b.id = idPrefix + tab.id;
    b.title = tab.title || tab.label;
    const icon = variant === 'icons' && typeof tab.iconSvg === 'function' ? tab.iconSvg() : '';
    if (icon) {
      const i = document.createElement('span');
      i.className = 'ui-tab-icon';
      i.innerHTML = icon;
      b.appendChild(i);
    }
    const t = document.createElement('span');
    t.className = 'ui-tab-label';
    t.textContent = tab.label;
    b.appendChild(t);
    b.addEventListener('click', () => onPick(tab.id));
    container.appendChild(b);
  }
  return (activeId) => {
    for (const b of container.querySelectorAll('.ui-tab')) {
      const on = b.dataset.tab === activeId;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  };
}
