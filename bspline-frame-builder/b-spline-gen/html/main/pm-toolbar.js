/**
 * main/pm-toolbar.js — 2026-10-10 (Fred, a shot of the Project Manager: Load / Rename / Delete sat in the BOTTOM bar):
 * the manager's ONE toolbar, at the top, declared once. Order: New Folder, New, Save As, Save | Load, Rename, Delete.
 * `needsSelection`: 'project' (a project, not a folder) / 'any' (a project or a folder) -- the button is enabled only
 * then (main/cloud-project-manager.js updateButtons reads it). `danger`: red, at the right end past a divider. The ids
 * are the ones the manager, the brick matrix and the cloud tests always used.
 */
export const PM_TOOLBAR = Object.freeze([
  Object.freeze({ id: 'fmBtnNewFolder', label: 'New Folder', icon: 'create_new_folder', title: 'Create a new (virtual) folder here' }),
  Object.freeze({ id: 'fmBtnNew', label: 'New', icon: 'note_add', title: 'New project: empty drawing, keeps the stock size and frame' }),
  Object.freeze({ id: 'fmBtnSaveAs', label: 'Save As…', icon: 'save_as', title: 'Save current state under a new name (Save As…)' }),
  Object.freeze({ id: 'fmBtnSave', label: 'Save…', icon: 'save', title: 'Save current state — prompts for a name', primary: true, labelClass: 'pm-save-label' }),
  Object.freeze({ id: 'fmBtnLoad', label: 'Load', icon: 'folder_open', title: 'Load the selected project (or double-click)', needsSelection: 'project', group: 'selection' }),
  Object.freeze({ id: 'fmBtnRename', label: 'Rename', icon: 'edit', title: 'Rename selected', needsSelection: 'any', group: 'selection' }),
  Object.freeze({ id: 'fmBtnDelete', label: 'Delete', icon: 'delete', title: 'Delete selected (no undo)', needsSelection: 'any', group: 'selection', danger: true }),
]);

/** Build the toolbar into `container` (once: a container already holding it is left alone). */
export function renderPmToolbar(container) {
  if (!container || container.querySelector('.pm-toolbar-btn')) return;
  let group = null;
  for (const b of PM_TOOLBAR) {
    if ((b.group || null) !== group) {
      group = b.group || null;
      if (container.children.length) container.appendChild(Object.assign(document.createElement('span'), { className: 'pm-toolbar-divider' }));
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = b.id;
    btn.title = b.title;
    btn.className = 'pm-toolbar-btn' + (b.primary ? ' pm-toolbar-btn-primary' : '') + (b.danger ? ' pm-toolbar-btn-danger' : '');
    if (b.needsSelection) btn.disabled = true;
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.style.fontSize = '14px';
    icon.textContent = b.icon;
    const label = document.createElement('span');
    if (b.labelClass) label.className = b.labelClass;
    label.textContent = b.label;
    btn.append(icon, label);
    container.appendChild(btn);
  }
}

/** Enable each selection button for what is selected: kind 'project' | 'folder' | null (nothing). */
export function syncPmToolbar(kind) {
  for (const b of PM_TOOLBAR) {
    if (!b.needsSelection) continue;
    const el = document.getElementById(b.id);
    if (el) el.disabled = b.needsSelection === 'project' ? kind !== 'project' : !kind;
  }
}
