/**
 * main/job-timeline-open.js -- what a click on a job timeline step opens (Fred 2026-10-14), through the app's OWN
 * openers: a step's kind declares `opens` (core/job-timeline.js JOB_STEP_KINDS) and this maps it --
 *   { sidebar: key }            -> the 3D view, its sidebar section revealed (main/sidebar-tabs.js revealSidebarSection);
 *   { editorTab, layer: true }  -> the 2D editor on that tab, the step's layer made the active one.
 */
import { isEditorOpen } from '../core/history.js';
import { revealSidebarSection } from './sidebar-tabs.js';
import { openEditorOn } from './frame-panel.js';
import { setEditorTab } from './editor-tabs.js';
import { setViewMode } from './view-mode-toggle.js';
import { setActiveLayer } from '../editor/layers.js';

export async function openJobStepTarget(step, opens) {
  if (!step || !opens) return;
  if (opens.sidebar) {
    if (isEditorOpen()) setViewMode('3d'); // the 2D/3D toggle's own way out (keeps the edits, like Apply)
    revealSidebarSection(opens.sidebar);
    return;
  }
  if (opens.editorTab) {
    if (isEditorOpen()) setEditorTab(opens.editorTab);
    else await openEditorOn(opens.editorTab);
    const ed = typeof window !== 'undefined' ? window.svgEditor : null;
    if (opens.layer && step.layerId != null && ed) setActiveLayer(ed, step.layerId);
  }
}
