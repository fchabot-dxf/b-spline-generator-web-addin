// The Brick matrix's groups, declared: one module per group, groups/<name>.mjs -- its rows / constants and, when it
// has one, its runner (bind + run). A seat adding rows or a check touches only its own group's file; run.mjs reads
// this index. GROUPS order = the order run.mjs had: the --parallel spawn order and the gate's per-group summary.
// A NEW group = a new groups/<name>.mjs + one line in MODULES below.
import * as wall from './wall.mjs';
import * as frame from './frame.mjs';
import * as brush from './brush.mjs';
import * as sidebarQuick from './sidebar-quick.mjs';
import * as sidebar3d from './sidebar-3d.mjs';
import * as layout from './layout.mjs';
import * as clear from './clear.mjs';
import * as lay from './lay.mjs';
import * as select from './select.mjs';
import * as migration from './migration.mjs';
import * as frameUi from './frame-ui.mjs';
import * as password from './password.mjs';
import * as layers from './layers.mjs';
import * as areas from './areas.mjs';
import * as undo from './undo.mjs';
import * as persistence from './persistence.mjs';
import * as grout from './grout.mjs';
import * as handedit from './handedit.mjs';
import * as strokes from './strokes.mjs';

const MODULES = {
  wall: wall,
  frame: frame,
  brush: brush,
  'sidebar-quick': sidebarQuick,
  'sidebar-3d': sidebar3d,
  layout: layout,
  clear: clear,
  lay: lay,
  select: select,
  migration: migration,
  'frame-ui': frameUi,
  password: password,
  layers: layers,
  areas: areas,
  undo: undo,
  persistence: persistence,
  grout: grout,
  handedit: handedit,
  strokes: strokes,
};

export const GROUPS = Object.keys(MODULES);
// every declared row, group by group (the row order inside a group is the order its rows run in)
export const BRICK_CONTROLS = GROUPS.flatMap((g) => MODULES[g].rows || []);
// a row's group is the file it lives in; an explicit `group` on a row (a Wall-tool row that needs the frame group's
// state) must name that same file
export const GROUP_OF = new Map(GROUPS.flatMap((g) => (MODULES[g].rows || []).map((r) => [r, g])));
for (const [r, g] of GROUP_OF) if (r.group && r.group !== g) throw new Error(`brick matrix: row "${r.name}" says group '${r.group}' but lives in groups/${g}.mjs`);
// a group's declared setup pins (each group file's `setup`), applied before its baseline lay
export const GROUP_SETUP = Object.fromEntries(GROUPS.filter((g) => MODULES[g].setup).map((g) => [g, MODULES[g].setup]));

// The APP's own declaration wins when it exists (seat 37: main/brick-control-requires.js, a pure data
// module the Brick panel greys controls out from): each of its entries' `controls` gets that `requires`,
// so the matrix checks the app against the app's rule instead of a second copy that could drift. Until
// that module lands, the NEEDS_* copies above stand in.
let appRequires = null;
try {
  ({ BRICK_CONTROL_REQUIRES: appRequires } = await import('../../../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js'));
} catch { /* not in this build yet */ }
if (Array.isArray(appRequires)) {
  for (const row of BRICK_CONTROLS) {
    const target = row.do.click || row.do.set;
    const decl = appRequires.find((d) => (d.controls || []).includes(target));
    // a board-fact rule (requires.fact, e.g. 'bricksLaid') names no control to copy: the page judges it
    // (run.mjs appRule -> the app's requirementMet) and the matrix always runs on a laid board
    if (decl && decl.requires.control) row.requires = { control: decl.requires.control, satisfied: decl.requires.satisfied, why: decl.why };
  }
}
export const REQUIRES_SOURCE = Array.isArray(appRequires) ? 'app (main/brick-control-requires.js)' : 'matrix fallback (groups/_shared.mjs NEEDS_*)';

// the runners, in GROUPS order; a group that reloads the page (runsLast) runs after every other one
export const RUNNER_ORDER = [...GROUPS.filter((g) => MODULES[g].run && !MODULES[g].runsLast), ...GROUPS.filter((g) => MODULES[g].run && MODULES[g].runsLast)];
// run.mjs hands its page / CDP helpers to every runner once, before the first one runs
export const bindGroups = (ctx) => { for (const g of RUNNER_ORDER) MODULES[g].bind(ctx); };
export const runGroup = (g) => MODULES[g].run();

// each group's named declarations, for run.mjs and older importers (controls.mjs re-exports this file)
export { PEEK_LAYOUT } from './layout.mjs';
export { CLEAR_MENU } from './clear.mjs';
export { LAY_WARNING, QUICK_FRAME_LAYS, BANDS_NOTE, WALL_NO_FRAME, CARVE_UNDER_FLAT } from './lay.mjs';
export { SELECT_ELEMENT } from './select.mjs';
export { MIGRATION } from './migration.mjs';
export { EDIT_PASSWORD_TEST } from './password.mjs';
export { BRICK_LAYERS } from './layers.mjs';
export { WALL_AREAS } from './areas.mjs';
export { UNDO_SETTINGS } from './undo.mjs';
export { PATTERN_PARAM_PERSIST, PERSIST_BOARD, GENERATE_AFTER_RESTORE } from './persistence.mjs';
export { GROUT_JOINTS } from './grout.mjs';
export { HAND_EDIT } from './handedit.mjs';
export { STROKE_CLEAR } from './strokes.mjs';
