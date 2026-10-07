// Brick matrix group 'frame': the Frame tool's editor rows (incl. two Wall-tool rows that need the frame group's state).
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { E, LAYOUT, LEVEL, click, set } from './_shared.mjs';

export const rows = [
  // ---- editor, Frame tool
  // item 28: a 3-band stack is reduced to what fits the board; at the 1 in default it keeps only its outer band on
  // T1 7x9 (= the Soldier the frame already has, nothing to see), at 3/4 in it keeps two
  { name: 'Brick size 3/4 (frame group: 3-band fits T1 7x9 from here)', kind: 'editor', tool: 'wall', group: 'frame', do: click('brickSizePreset_quarter3'), expect: LAYOUT },
  { name: 'Frame preset: 3-band', kind: 'editor', tool: 'frame', do: click('brickFramePreset_three_band'), expect: LAYOUT },
  { name: 'Band 1 pattern: Header', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_header'), expect: LAYOUT },
  // item 23: a Fieldstone band makes the whole frame rock (every band); then the per-element rule -- the Frame
  // tool's Set changes the frame only, a rock wall stays rock
  { name: 'Band 1 pattern: Fieldstone', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_fieldstone'), expect: { ...LAYOUT, sets: { frame: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Wall pattern: Fieldstone (frame group)', kind: 'editor', tool: 'wall', group: 'frame', do: click('brickPattern_fieldstone'), expect: { ...LAYOUT, sets: { wall: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Frame Set: Red Brick, the rock wall stays', kind: 'editor', tool: 'frame', do: click('brickSet_1'), expect: { ...LAYOUT, sets: { frame: 1, wall: 3 } }, introducedBy: '40c4bdf' },
  // F35 item 46 (Fred: band rows "can't be changed back after clicking" Fieldstone): rock again, then a course pattern on
  // band 1 brings the brick frame back (its own set) -- the Soldier button must exist on a rock frame's row
  { name: 'Band 1 pattern: Fieldstone again (rock frame)', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_fieldstone'), expect: { ...LAYOUT, sets: { frame: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Band 1 pattern: Soldier, back from rock (item 46)', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_soldier'), expect: { ...LAYOUT, sets: { frame: 1 } }, introducedBy: '40c4bdf' },
  // F35 item 61 (seat E): the Frame Set row lists every band-capable set -- Grey stone lays its own stones, White rocks makes
  // the frame rock (the set implies the pattern) and a course band pattern brings Grey stone back (the pattern implies the set)
  { name: 'Frame Set: Grey stone (its own stones)', kind: 'editor', tool: 'frame', do: click('brickSet_5'), expect: { ...LAYOUT, sets: { frame: 5 } }, introducedBy: '0922034' },
  { name: 'Frame Set: White rocks (the frame turns rock)', kind: 'editor', tool: 'frame', do: click('brickSet_3'), expect: { ...LAYOUT, sets: { frame: 3 } }, introducedBy: '0922034' },
  { name: 'Band 1 pattern: Soldier, back to Grey stone', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_soldier'), expect: { ...LAYOUT, sets: { frame: 5 } }, introducedBy: '0922034' },
  { name: 'Frame Set: Red Brick again', kind: 'editor', tool: 'frame', do: click('brickSet_1'), expect: { ...LAYOUT, sets: { frame: 1 } }, introducedBy: '0922034' },
  // F35 item 66: the 'Frame offset distance / off / on' rows went with the retired Offset-from-frame control
  { name: 'Frame Level -1/8', kind: 'editor', tool: 'frame', do: set('brickLevel_frame', -0.125), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Frame Level 0', kind: 'editor', tool: 'frame', do: set('brickLevel_frame', 0), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Frame preset: None', kind: 'editor', tool: 'frame', do: click('brickFramePreset_none'), expect: LAYOUT },
  { name: 'Frame preset: Soldier', kind: 'editor', tool: 'frame', do: click('brickFramePreset_single_soldier'), expect: LAYOUT },
  // item 9: the frame crumbles by the wall's rule (its own amount, greyed while off), and the inset window's brick
  // surround (part of the Frame element; its rows show while the inset window is on)
  { name: 'Crumble frame too: on', kind: 'editor', tool: 'frame', do: click('brickSuppressFrame'), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Frame crumble amount 0.6', kind: 'editor', tool: 'frame', do: set('brickFrameSuppression', 0.6), expect: LAYOUT, introducedBy: 'item9' },
  // Clumping shapes the frame crumble too: live (and re-lays the frame) at wall Suppression 0 (brick-control-requires anyOf)
  { name: 'Clumping 0.9 (frame crumbles, wall Suppression 0)', kind: 'editor', tool: 'frame', do: set('brickClumping', 0.9), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Crumble frame too: off', kind: 'editor', tool: 'frame', do: click('brickSuppressFrame'), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Frame crumble amount while off (greyed)', kind: 'editor', tool: 'frame', do: set('brickFrameSuppression', 0.4), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Inset window on (for the surround)', kind: 'editor', tool: 'frame', do: click('editorFrameInsetWindowToggle'), expect: E(false, null, null), introducedBy: 'item9' },
  { name: 'Window surround: Soldier', kind: 'editor', tool: 'frame', do: click('brickSurroundPreset_single_soldier'), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Window surround corners: Butt', kind: 'editor', tool: 'frame', do: click('brickSurroundCorner_butt'), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Window surround: None', kind: 'editor', tool: 'frame', do: click('brickSurroundPreset_none'), expect: LAYOUT, introducedBy: 'item9' },
  { name: 'Inset window off', kind: 'editor', tool: 'frame', do: click('editorFrameInsetWindowToggle'), expect: E(false, null, null), introducedBy: 'item9' },
];

// ---- group setup pins (advisor, 2026-10-05): what a group's rows depend on is declared, never the new-board default.
// The frame group's rows were measured at 1 in; the default moving to 1.25 in (37, 124b799) made T1 7x9 three soldier
// bands fill the board (B1's empty wall) and failed "Frame Set: Red Brick, the rock wall stays" -- a default leaking
// into a fixture, the same class as MIGRATION's neutral set. Applied when the group runs on its own (--parallel = the
// gate); an all-groups run shares one baseline with the wall group's own size rows, so it is left as is.
export const setup =
  [{ set: 'brickSize', value: 1, event: 'change', why: 'the frame rows were measured at 1 in' }];
