/**
 * editor/editor-tool-registry.js — F35 (advisor: "ONE declared tool registry per tab driving the
 * active-tool highlight for all tabs, Brick/Photo use the same mechanism as Artwork's tools" —
 * explicitly a modest unification, NOT a shared editor._currentMode refactor: Wall/Frame/Photo's
 * tools have no gesture "mode" of their own to unify onto).
 *
 * Before this, Brick (main/brick-panel.js) and Photo (main/photo-panel.js) each carried their own,
 * textually-identical render + active-class-toggle loop over a declared `[{id, label, icon, hint}]`
 * array. Declared ONCE here instead; each panel supplies its own registry + its own click callback
 * (still whatever that tab's own tool actually does — arming a gesture mode, running an immediate
 * action, switching a settings section — this module has no opinion on that).
 *
 * Artwork's own tool buttons stay static HTML (richer inline SVG icons, not a plain icon
 * character) — `renderToolRegistry` isn't used for them, but `syncToolRegistryButtons` is, from
 * `editor-ui.js`'s own `setMode`, fed a plain `{id, buttonId}` list (ARTWORK_TOOL_IDS) so the
 * SAME toggle function drives all three tabs' own highlight, not three copies of the same loop.
 */
export function renderToolRegistry(container, registry, onSelect) {
  if (!container) return;
  container.innerHTML = '';
  for (const tool of registry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    // F35 item 16 follow-up (Fred, live use: "can't tell which tool is selected"): a plain text/
    // emoji icon has nothing equivalent to Artwork's own static SVG buttons' `.tool-btn.active svg`
    // bold-stroke treatment (editor.css) -- the SAME pale `.tool-btn.active` background alone reads
    // as a much weaker highlight without it. `tool-btn-emoji` scopes a stronger, solid-fill active
    // style (editor.css) to ONLY registry-rendered buttons (Brick/Photo), leaving Artwork's own
    // static buttons' existing look untouched.
    btn.className = 'tool-btn tool-btn-emoji';
    btn.id = tool.buttonId;
    btn.title = tool.hint ? `${tool.label} — ${tool.hint}` : tool.label;
    btn.textContent = tool.icon;
    btn.addEventListener('click', () => onSelect(tool.id));
    container.appendChild(btn);
  }
}

export function syncToolRegistryButtons(registry, activeId) {
  for (const tool of registry) {
    document.getElementById(tool.buttonId)?.classList.toggle('active', tool.id === activeId);
  }
}
