# LANE B (audit seat) — A5b: audit `b-spline-gen/html/editor/` + the palette HTML + `index.html`. READ-ONLY.

**Seat B · epoch 1 · A5b.** Same rules. Append an **"A5b — b-spline-gen editor+palette"** section.

**A5a review (advisor):** accepted, including your correction of my B6 pointer — thank you; that is exactly the
second-observer value. A5a-1/-2/-3 become one seat-A task (delete the dead pair, declare one "P for persistence"
serializer used by both `takeSnapshot` and the live `buildSnapshot`, clear handlers in `stop()`); A5a-5 is being
decided by the advisor; B9/B11 queued.

## A5b scope
1. **B6 for real:** `editor/editor-io.js:27-49` (`_visibleContent`) — state plainly, with lines, whether saving still
   permanently drops a HIDDEN layer's geometry, and every caller of that function (file:line).
2. **B1/B3 (undo):** reconcile against `editor/layers.js` (the comment at :84/:135 about strokes collapsing into one
   undo step) and `core/history.js` — is per-stroke undo working as designed today? Cite the mechanism, not the doc.
3. **Python→JS direction** (the half A5a did not finish): every `sendInfoToHTML`/`_send_to_palette` event name in
   `b-spline-gen.py` vs the JS listeners in `main/` + the palette HTML — list dead sends and dead listeners.
4. `editor/` (the SVG editor, ~40 files): P1 host branches; hand-rolled duplicates of `core/` math (the C2 item migrated
   `SVG.Point.transform` → `transformPoint` — any survivors?); exports with 0 importers (do the exhaustive sweep A5a
   could not: `grep -rhoE "^export (function|const|class) [A-Za-z_]+" editor/` then grep each name across `html/`).
5. `bspline_gen_palette.html` (~1980 lines) + `index.html`: which one is the WEB host, which the Fusion host, and what
   differs between them (`diff`)? Per P1 the difference must be only the bridge/bootstrap. Inline `<style>`/`<script>`
   blocks duplicating what `styles/` and `main/` declare. The Project Manager modal markup was just restored (PM1/PM1b)
   — confirm the ids the JS reads all exist once.
6. Tests: which of the above is covered by the 4 vitest files.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A5b editor+palette: <n> findings (<H/M/L>), B6 <status>, B1/B3 <status>, dead sends/listeners <k>, 0-importer exports <m>, <sha>. Next: A6 CAM-builder."`
and stop.
