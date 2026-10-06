// F35 item 70: what Fusion is doing during a Send, DECLARED ONCE. The palette imports this module; the add-in
// (b-spline-gen.py, _fusion_send_stage_ids) reads this same file, drops everything up to the line that starts with
// the export and json-loads the rest -- so the object below must stay pure JSON (double quotes, no comments, no trailing commas).
// Order = the add-in's own order in _handle_generate; the palette shows "Waiting - Fusion: <label>, step i of n".
export default {
  "stages": [
    { "id": "fusionPrepare", "label": "preparing the design" },
    { "id": "fusionImportStep", "label": "importing the STEP" },
    { "id": "fusionStamp", "label": "stamping the artwork" },
    { "id": "fusionBricks", "label": "importing the bricks" },
    { "id": "fusionCleanup", "label": "cleaning up" },
    { "id": "fusionFrame", "label": "building the frame" },
    { "id": "fusionFinalize", "label": "finishing" }
  ]
}
