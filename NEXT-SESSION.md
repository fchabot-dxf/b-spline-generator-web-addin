# NEXT — E7b Frame Inspector readability: fold the sections + DECLARE the metadata as fields [F]

**Ball: worker · epoch 1 · E7b.** Files: `bspline-frame-builder/fb_shared/entity_helpers.py`,
`bspline-frame-builder/frame-inspector/fusion-inspector.py`, `bspline-frame-builder/frame-inspector/inspector_palette.html`.
One commit by path, predicted **3 files**. Per-row copy buttons are E7c (next turn) — not this one.

## Ground truth (advisor-verified)
- The two section headers (`ENTITY DATA` :63-66, `TECHNICAL META` :80-83) carry an `arrow_drop_down` icon but no click
  handler — a door with no room. `styles/base.css:1081-1090` ALREADY declares the collapse states:
  `.collapsed .cad-accordion-icon { rotate(-90deg) }` and `.cad-dialog-content.collapsed { display:none }`. So folding
  = toggle the `collapsed` class on the header AND on its next sibling `.cad-dialog-content`. No new CSS.
- `meta` today is ONE pipe-joined string built at `fusion-inspector.py:553-555` from `objectType`, `get_fb_bridge`,
  `get_fb_plan` and `get_fb_metadata(e)` (which itself joins `StartID= | EndID= | CenterID= | Bulge=(x,y)` —
  `fb_shared/entity_helpers.py:210-235`). The palette dumps it into `#meta-text` as monospace text (:159).
  Structure is thrown away in Python and would have to be re-inferred in JS — declare it instead.
- `get_fb_metadata` is ALSO consumed by template-maker (`core/template_payload.py:1`, `core/template_payload_builder.py:12,230`)
  → its string output must stay **byte-identical**.
- `styles/base.css:1099` declares `.cad-field-row` (grid `120px 1fr`) + `.cad-label` — the label/value row shape to reuse.

## Do
1. **`fb_shared/entity_helpers.py` — one truth, two renderings.** Add `get_fb_metadata_fields(ent) -> dict` returning
   ONLY the keys that have values, from: `{'startId': StartID, 'endId': EndID, 'centerId': CenterID, 'bulge': "(x,y)"}`
   (same sources and same rounding as today). Then REPLACE the body of `get_fb_metadata` so it derives its string from
   that dict: `' | '.join(f"{label}={v}")` with labels `StartID/EndID/CenterID/Bulge` in that order — byte-identical
   to today's output. Do not add a parallel path; the string function must call the dict function.
2. **`fusion-inspector.py:552-555`** — emit `p_data['meta']` as a dict:
   `{'type': <objectType short>, 'bridge': bridge or '', 'plan': plan or '', **get_fb_metadata_fields(e)}`.
   Leave the BATCH `linked` string entries (:536-549) exactly as they are (E7c territory).
   Keep the initial `'meta': f"{count} Entities Selected"` placeholder (:505) — change it to `{}` so the type is one thing.
3. **`inspector_palette.html`**
   (a) DECLARE the row list once: `const META_FIELDS = [['type','Type'],['bridge','Bridge'],['plan','Plan'],
   ['startId','Start ID'],['endId','End ID'],['centerId','Center ID'],['bulge','Bulge']];`
   Render `#meta-text` as one `.cad-field-row` per key present (`.cad-label` + a value `<span>`), skipping empty
   values; if `meta` is not an object (older Python still running), fall back to `textContent = String(meta)`.
   (b) Folding: on `init()`, for each `.cad-accordion-header` that is a DIRECT child of `.cad-sidebar-panel`
   (NOT the `.dark` sub-label `#list-label`), add a click listener that toggles `collapsed` on the header and on
   `header.nextElementSibling` (the `.cad-dialog-content`). Both sections start expanded. Nothing else.
   (c) Remove the now-dead `white-space: pre-wrap` monospace styling on `.meta-container` ONLY if nothing else uses
   the class (grep); otherwise leave it.

## Verify (fast tier)
- `python -m py_compile` on both .py files.
- **Byte-identity gate for the shared helper:** `pytest bspline-frame-builder/template-maker/tests -q` (template-maker
  consumes `get_fb_metadata`) → same green count as before your change. Run it BEFORE and AFTER; report both counts.
- Grep: `META_FIELDS` declared once; `#meta-text` written only through the row renderer; `collapsed` toggled in exactly
  one function.
- `git show --stat HEAD` → 3 files.
- Fusion look is the ADVISOR's (deploy + screenshot): sections fold on click, meta shows as labelled rows.

## Do NOT
Don't touch `frame-builder/` (E8 human gate). Don't add CSS that base.css already declares. Don't restructure
`linked`/`linked_expr`. Don't add copy buttons (E7c). Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "E7b: get_fb_metadata_fields declared + get_fb_metadata derives from it (byte-identical; template-maker pytest <before>/<after>); meta emitted as dict; META_FIELDS rows + section folding via base.css collapsed — <sha>, 3 files. Next: E7c per-row copy."`
and stop.
