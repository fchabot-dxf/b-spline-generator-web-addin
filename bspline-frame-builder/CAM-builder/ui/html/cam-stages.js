// F35 item 70: what Fusion is doing during the CAM palette's BUILD SETUPS and APPLY TOOLPATHS, DECLARED ONCE. The
// palette imports this module (cam-loading.js); the add-in (cam-builder.py, _cam_stage_ids) reads this same file,
// drops everything up to the line that starts with the export and json-loads the rest -- so the object below must
// stay pure JSON. The palette shows "Waiting - Fusion: <label>, step i of n" on the shared loading card.
export default {
  "stages": [
    { "id": "camWcs", "label": "preparing the stock sketches" },
    { "id": "camCleanup", "label": "clearing the old setups" },
    { "id": "camModels", "label": "building the Manufacturing Models" },
    { "id": "camSetups", "label": "building the Setups" },
    { "id": "camTemplates", "label": "applying the toolpath templates" },
    { "id": "camToolpaths", "label": "starting the toolpaths" },
    { "id": "camBuildApply", "label": "applying toolpaths" },
    { "id": "camTpgen", "label": "generating the toolpaths" }
  ],
  "sequences": {
    "camBuild": ["camWcs", "camCleanup", "camModels", "camSetups", "camBuildApply", "camTpgen"],
    "camApply": ["camTemplates", "camToolpaths", "camTpgen"]
  }
}
