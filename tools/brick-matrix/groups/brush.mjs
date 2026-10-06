// Brick matrix group 'brush': the Brush / Raised brush settings and the Stripe panel picks.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { E, click, NEEDS_THREE_STYLES, STRIPE, set } from './_shared.mjs';

export const rows = [
  // ---- Brush settings (new strokes)
  { name: 'Brush profile: Continuous', kind: 'brush', do: click('brickBtnProfileContinuous'), expect: E(false, true, null) },
  { name: 'Brush orientation: Soldier', kind: 'brush', do: click('brickBtnOrientationSoldier'), expect: E(false, true, null) },
  { name: 'Brush profile: Stripped', kind: 'brush', do: click('brickBtnProfileStripped'), expect: E(false, true, null) },
  { name: 'Brush preset: 2-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_2_running'), expect: E(false, true, null) },
  { name: 'Brush preset: 1-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_1'), expect: E(false, true, null) },
  // F35 item 16 (seat 37): the Raised brush -- its Level lifts each new stroke's bricks (data-brick-height-offset);
  // its Grout mode waits for the engine's groutCut (main/brick-control-requires.js hides it until then)
  { name: 'Raised brush level 1/8', kind: 'brush', tool: 'raisedBrush', do: set('brickRaisedLevel', 0.125, 'input'), expect: E(false, true, null), introducedBy: '0f45668' },
  { name: 'Raised brush mode: Grout', kind: 'brush', tool: 'raisedBrush', do: click('brickRaisedMode_grout'), expect: E(false, true, null), introducedBy: '0f45668' },
  // ---- Stripe panel brick-style picks (seat 37, fb-app 702876d)
  { name: 'Stripe A: White continuous', kind: 'stripe', do: click('stripeBrickStyle_A_white_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe B: Red continuous', kind: 'stripe', do: click('stripeBrickStyle_B_red_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe C: White bricks', kind: 'stripe', do: click('stripeBrickStyle_C_white_bricks'), expect: STRIPE, introducedBy: '702876d', requires: NEEDS_THREE_STYLES },
];
