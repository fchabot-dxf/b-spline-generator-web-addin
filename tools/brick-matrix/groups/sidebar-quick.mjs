// Brick matrix group 'sidebar-quick': the main sidebar's quick settings and the buttons that open the editor.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { E, AUTO, click } from './_shared.mjs';

export const rows = [
  // ---- main sidebar
  // (item 23: the quick Set row lists the brick sets only -- one choice today, nothing to change)
  { name: 'Quick size: 1-1/2', kind: 'sidebar', do: click('brickQuick_size_half1'), expect: AUTO },
  { name: 'Quick size: 3/4', kind: 'sidebar', do: click('brickQuick_size_quarter3'), expect: AUTO },
  { name: 'Quick pattern: Herringbone', kind: 'sidebar', do: click('brickQuick_pattern_herringbone'), expect: AUTO },
  { name: 'Quick frame bands: 3-band', kind: 'sidebar', do: click('brickQuick_frameBands_three_band'), expect: AUTO },
  { name: 'Quick grout colour: Charcoal (paint only)', kind: 'sidebar', do: click('brickQuick_groutColor_charcoal'), expect: E(false, true, false), introducedBy: '3a10b65' }, // F35 item 55
  // turn 207 (Fred): the BRICK section's "Brick editor" button opens the editor on the Brick tab
  { name: 'Brick editor button', kind: 'opens', do: click('btnEditBricks'), expect: { tab: 'brick' }, introducedBy: '979ada1' },
  // F35 item 25: the viewport's [2D] opens the editor on the last-used tab (Brick: the row above left it there),
  // the editor's [3D] closes it again (Apply, or just close when nothing changed)
  { name: 'Viewport 2D / 3D pill', kind: 'opens', do: click('viewMode_2d'), expect: { tab: 'brick' }, closeWith: 'viewMode_3d_editor', introducedBy: '3447e95' },
];
