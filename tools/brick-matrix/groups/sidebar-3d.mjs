// Brick matrix group 'sidebar-3d': the main sidebar's 3D-only settings.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { SURFACE, click, NEEDS_RECESSED, set } from './_shared.mjs';

export const rows = [
  { name: 'Relief: Carved', kind: 'sidebar', do: click('brickBtnReliefCarved'), expect: SURFACE },
  { name: 'Relief: Raised', kind: 'sidebar', do: click('brickBtnReliefRaised'), expect: SURFACE },
  // turn 207: a new board starts Flat + Recessed (core/state.js), so each pair first moves AWAY from the default
  { name: 'Brick top: Organic', kind: 'sidebar', do: click('brickBtnTopOrganic'), expect: SURFACE },
  { name: 'Brick top: Flat', kind: 'sidebar', do: click('brickBtnTopFlat'), expect: SURFACE },
  { name: 'Surface: Weathered', kind: 'sidebar', do: click('brickSurfaceStyle_weathered'), expect: SURFACE },
  { name: 'Wear 0.9 (Weathered)', kind: 'sidebar', do: set('brickSurfaceWear', 0.9), expect: SURFACE },
  { name: 'Surface: Clean', kind: 'sidebar', do: click('brickSurfaceStyle_clean'), expect: SURFACE },
  { name: 'Max Height 0.2', kind: 'sidebar', do: set('brickReliefHeight', 0.2), expect: SURFACE },
  { name: 'Grout: Flush', kind: 'sidebar', do: click('brickBtnGroutFlush'), expect: SURFACE },
  { name: 'Grout depth 0.05 (Flush)', kind: 'sidebar', do: set('brickGroutDepth', 0.05), expect: SURFACE, requires: NEEDS_RECESSED },
  { name: 'Grout: Recessed', kind: 'sidebar', do: click('brickBtnGroutRecessed'), expect: SURFACE },
  { name: 'Grout depth 0.1 (Recessed)', kind: 'sidebar', do: set('brickGroutDepth', 0.1), expect: SURFACE, requires: NEEDS_RECESSED },
  // BRICK audit A8: the checkbox lives in the FILTER section now (a surface setting); still a 3D-only sidebar control
  { name: 'Hide filter texture', kind: 'sidebar', do: click('isolateSkeleton'), expect: SURFACE },
];
