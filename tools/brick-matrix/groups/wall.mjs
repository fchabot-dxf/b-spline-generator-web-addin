// Brick matrix group 'wall': the Wall tool's editor rows (+ its Generate re-lay row).
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { E, RED_SET, ROCK_SET, AT_ONCE, LAYOUT, LEVEL, SURFACE, click, NEEDS_SUPPRESSION, set } from './_shared.mjs';

export const rows = [
  // ---- editor, Wall tool
  // (item 23: the Set row lists the brick sets only -- today just Red Brick -- so it has no row to change;
  // rocks come from the Fieldstone pattern, checked by `sets` below)
  { name: 'Wall pattern: Herringbone', kind: 'editor', tool: 'wall', do: click('brickPattern_herringbone'), expect: LAYOUT },
  { name: 'Wall pattern: Basketweave', kind: 'editor', tool: 'wall', do: click('brickPattern_basketweave'), expect: LAYOUT },
  // T86 item 13 (37, fb-app f85c8d1): Fred's sheet patterns, layouts/sheet-patterns.js
  ...[['stacked_horizontal', 'Stacked horizontal'], ['chevron', 'Chevron'], ['stacked_variation', 'Stacked variation'],
    ['basketweave_variation', 'Basketweave variation'], ['basketweave_stacked', 'Basketweave + stacked']]
    .map(([id, name]) => ({ name: `Wall pattern: ${name}`, kind: 'editor', tool: 'wall', do: click(`brickPattern_${id}`), expect: LAYOUT, introducedBy: 'f85c8d1' })),
  // T86 item 14 (37, fb-app 59550fe): the tiles (Fred's sheet 3); octagon + square last, its ratio chips right after
  ...[['square_grid', 'Square grid'], ['square_diamond', 'Square + diamond'], ['hexagon', 'Hexagon'], ['lozenge', 'Lozenge'],
    ['framed_square', 'Framed square'], ['octagon_square', 'Octagon + square']]
    .map(([id, name]) => ({ name: `Wall pattern: ${name}`, kind: 'editor', tool: 'wall', do: click(`brickPattern_${id}`), expect: LAYOUT, introducedBy: '59550fe' })),
  { name: 'Octagon + square: ratio S', kind: 'editor', tool: 'wall', do: click('brickPatternParam_ratio_0'), expect: LAYOUT, introducedBy: '59550fe' },
  { name: 'Octagon + square: ratio L', kind: 'editor', tool: 'wall', do: click('brickPatternParam_ratio_2'), expect: LAYOUT, introducedBy: '59550fe' },
  { name: 'Wall pattern: Fieldstone', kind: 'editor', tool: 'wall', do: click('brickPattern_fieldstone'), expect: { ...LAYOUT, sets: { wall: 3 }, reads: { brickGroutWidth: ROCK_SET.grout.widthIn } } },
  // per-element joint: the Frame tool shows the frame's own (Red Brick) joint while the wall is rock
  { name: 'Frame tool shows its own joint', kind: 'editor', tool: 'wall', do: click('brickTool_frame'), expect: { ...E(false, false, false), commit: 'at once', reads: { brickGroutWidth: RED_SET.grout.widthIn } }, introducedBy: '1404b72' },
  { name: 'Back to the Wall tool', kind: 'editor', tool: 'wall', do: click('brickTool_wall'), expect: { ...E(false, false, false), commit: 'at once', reads: { brickGroutWidth: ROCK_SET.grout.widthIn } }, introducedBy: '1404b72' },
  // shown only for a fieldstone wall (White Rocks or the Fieldstone pattern) -- hence right after the row above
  { name: 'Large stones 0.6 (Fieldstone)', kind: 'editor', tool: 'wall', do: set('brickLargeStones', 0.6), expect: LAYOUT, introducedBy: '88c7616' },
  // T86 item 25 + 37's a30a605: Coursed rubble picks Set 5 (Grey stone) the way Fieldstone picks Set 3 (after the
  // fieldstone rows: rows run in sequence, and Large stones needs the Fieldstone wall)
  { name: 'Wall pattern: Coursed rubble', kind: 'editor', tool: 'wall', do: click('brickPattern_coursed_rubble'), expect: { ...LAYOUT, sets: { wall: 5 } }, introducedBy: 'a30a605' },
  { name: 'Wall pattern: None', kind: 'editor', tool: 'wall', do: click('brickPattern_none'), expect: LAYOUT },
  { name: 'Wall pattern: Stretcher', kind: 'editor', tool: 'wall', do: click('brickPattern_stretcher'), expect: LAYOUT },
  // T86 item 29 + F35 item 13 (37, fb-app 8d8d3f1): the wall rotation chips; 45 then back to 0 -- `backTo`: this row's
  // canvas and 3D must equal the named row's BEFORE-state (the same lay as before the turn)
  { name: 'Wall rotation 45', kind: 'editor', tool: 'wall', do: click('brickWallRotation_45'), expect: LAYOUT, introducedBy: '8d8d3f1' },
  { name: 'Wall rotation 0 (back)', kind: 'editor', tool: 'wall', do: click('brickWallRotation_0'), expect: { ...LAYOUT, backTo: 'Wall rotation 45' }, introducedBy: '8d8d3f1' },
  // Level (audit v2 N6; item 27): an editor Level change re-lays at once like every editor setting (LEVEL
  // profile: no pending dot, relief changes); the 2D canvas is not checked (a level is height only)
  { name: 'Wall Level +1/8', kind: 'editor', tool: 'wall', do: set('brickLevel_wall', 0.125), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Wall Level 0', kind: 'editor', tool: 'wall', do: set('brickLevel_wall', 0), expect: LEVEL, introducedBy: '90a1483' },
  // F35 item 15 (seat 37): raised accents on the Wall -- 3D-only (never pending); the 2D shows an outline only
  { name: 'Raised accents: Course bands', kind: 'editor3d', tool: 'wall', do: click('brickAccent_courseBand'), expect: SURFACE, introducedBy: '82f3755' },
  { name: 'Accent level -1/16', kind: 'editor3d', tool: 'wall', do: set('brickAccentLevel', -0.0625), expect: SURFACE, introducedBy: '82f3755' },
  { name: 'Raised accents: None', kind: 'editor3d', tool: 'wall', do: click('brickAccent_none'), expect: SURFACE, introducedBy: '82f3755' },
  // F35 items 31b + 31e (seat C 02): the pattern builder -- open it (nothing laid yet: an empty tile), Checker's tile at
  // unit 1 (3D only), switch to 1/2 (the engine CUTS the bricks at the tile's cells: a re-lay), base Custom (a blank
  // custom bond: every cell its own half-brick piece), offset course 1 (the marks travel with it), then back to the
  // plain Stretcher (it drops the custom tile and closes the builder: the size rows below start from a plain wall)
  { name: 'Pattern builder: open (Custom...)', kind: 'editor3d', tool: 'wall', do: click('brickAccentCustomOpen'), expect: E(false, null, null), introducedBy: '3c93a36' },
  // a preset's tile, not one tapped cell: at unit 1 a cell maps to bricks by absolute board column, and on this group's
  // baseline (a wall inside a Soldier frame, T1's narrow waist) tile cell (0, 1) lands on no brick at all (measured)
  { name: 'Pattern builder: start from Checker (unit 1)', kind: 'editor3d', tool: 'wall', do: set('brickBuilderStartFrom', 'checker'), expect: SURFACE, introducedBy: '3c93a36' },
  { name: 'Pattern builder unit 1/2 (cuts at the cell)', kind: 'editor', tool: 'wall', do: click('brickBuilderUnit_half'), expect: LAYOUT, introducedBy: 'ff7d6ba' },
  // 3D not checked, by construction: Checker at 1/2 already cut every brick into its two cells, and the blank custom
  // bond IS those cells -- the same surface (measured); the canvas re-lays (new pieces), the offset row checks the 3D
  { name: 'Pattern builder base Custom (blank grid)', kind: 'editor', tool: 'wall', do: click('brickBuilderBase_custom'), expect: { ...LAYOUT, threeD: null }, introducedBy: '1f7e9d3' },
  { name: 'Pattern builder: offset course 1', kind: 'editor', tool: 'wall', do: click('brickBuilderOffset_0_right'), expect: LAYOUT, introducedBy: '1f7e9d3' },
  { name: 'Wall pattern: Stretcher (drops the custom bond)', kind: 'editor', tool: 'wall', do: click('brickPattern_stretcher'), expect: LAYOUT, introducedBy: '1f7e9d3' },
  { name: 'Brick size preset 1-1/2', kind: 'editor', tool: 'wall', do: click('brickSizePreset_half1'), expect: LAYOUT },
  { name: 'Brick size stepper 1.0', kind: 'editor', tool: 'wall', do: set('brickSize', 1), expect: LAYOUT },
  { name: 'Brick size slider (log 500)', kind: 'editor', tool: 'wall', do: set('brickSizeSlider', 500), expect: LAYOUT },
  { name: 'Brick size preset 3/4', kind: 'editor', tool: 'wall', do: click('brickSizePreset_quarter3'), expect: LAYOUT },
  { name: 'Grout width 0.08', kind: 'editor', tool: 'wall', do: set('brickGroutWidth', 0.08, 'input'), expect: LAYOUT },
  // F35 item 55 (seat E): the grout PAINT -- the canvas changes (the grout node's d / fill), the 3D heights must NOT (paint only)
  { name: 'Grout edge 0.03 (paint only)', kind: 'editor', tool: 'wall', do: set('brickGroutEdge', 0.03), expect: { ...E(false, true, false), ...AT_ONCE }, introducedBy: '3a10b65' },
  // seat D (measured): the baseline's Generate re-rolls the brick seed (F35 item 39), and on some seeds the top bias
  // (0.8 x course height vs 0.2 x noise, core/bricks/suppression.js) removes the same top pieces whatever the noise
  // scale -- Clumping is then a genuine no-op and its row failed at random (same canvas as the row before). A declared
  // seed makes Suppression + Clumping test the controls, not the dice.
  { name: 'Brick seed 7919 (Suppression/Clumping rows)', kind: 'editor', tool: 'wall', do: set('brickSeed', 7919, 'input'), expect: LAYOUT },
  { name: 'Suppression 0.5', kind: 'editor', tool: 'wall', do: set('brickSuppression', 0.5), expect: LAYOUT },
  { name: 'Clumping 0.9 (Suppression 0.5)', kind: 'editor', tool: 'wall', do: set('brickClumping', 0.9), expect: LAYOUT, requires: NEEDS_SUPPRESSION },
  { name: 'Suppression 0', kind: 'editor', tool: 'wall', do: set('brickSuppression', 0), expect: LAYOUT },
  { name: 'Clumping 0.1 (Suppression 0)', kind: 'editor', tool: 'wall', do: set('brickClumping', 0.1), expect: LAYOUT, requires: NEEDS_SUPPRESSION },
  { name: 'Seed 77', kind: 'editor', tool: 'wall', do: set('brickSeed', 77, 'input'), expect: LAYOUT },
  { name: 'Random seed', kind: 'editor', tool: 'wall', do: click('brickBtnRandomSeed'), expect: LAYOUT },
  // F35 item 39 (Fred: a restored board "isn't refreshable by a simple Generate"): Generate rolls a NEW brick seed --
  // the removed brick comes back (same count) in a new layout; before item 39 it put back the identical layout
  { name: 'Generate re-lays now, a new seed (wall)', kind: 'relay', tool: 'wall', do: click('brickGenerate'), expect: { restores: true, newSeed: true }, introducedBy: '9eb45d2' },
];
