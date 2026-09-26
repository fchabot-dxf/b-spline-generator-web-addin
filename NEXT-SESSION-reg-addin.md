# NEXT (reg-addin, Asus) — R3: STALE-PARAMS design (DESIGN ONLY, no product code)

**Ball: worker (reg-addin) · epoch 1 · R3.** NO FUSION, NO product-code edits. R2 (809f870 lockfile, c20e538) ACCEPTED.
Plan of record = HANDOFF-REG-ADDIN.md §3 item 5. Log = WORK-LOG-reg-addin.md. Commit subject "R3 item N: …".

Why design-first: Send will DELETE user parameters in Fred's Fusion designs — an irreversible move on his data.
The advisor gates the plan before any code is written (R4 implements what's blessed).

## Hands off (unchanged)
Seat A (UI5 still merging): editor-lattice-pattern.js, editor-ui.js, editor.js, editor-piece-override.js,
properties-lattice.js, properties-shape-lattice.js, tools/repro/select_drag_shape.mjs. Seat C (fb-app): frame-record.js,
editor-frame-profile.js, frame-mesh.js, editor-shape-lattice-generator.js, frame-builder/, FB-APP-DESIGN.md (READ it
from origin/fb-app — `git show origin/fb-app:FB-APP-DESIGN.md` — never edit or check out fb-app).

## Checklist
- [ ] [R3-item-1] SURVEY (facts, with file:line): every user parameter the add-in creates today — where (b-spline-gen.py,
      sketch_manifest_builder.py, the Send/payload path, the Frame Builder side), its name pattern, whether it's created
      conditionally (e.g. contour_width only with a contour, per-piece dims, widthIn/heightIn from Send), and how an
      existing one is updated vs re-created. Also: what marks a param as ours today, if anything (comment? attribute? name?).
- [ ] [R3-item-2] DESIGN `STALE-PARAMS-DESIGN.md` (repo root):
      a) ONE declared ownership list (data, one module) of the params/patterns the add-in owns — incl. frame params, with
         names cross-checked against FB-APP-DESIGN.md on fb-app (list any mismatch for the home advisor to settle).
      b) how "created by us" is proven at delete time (proposal: an attribute/comment stamp written at creation; a param
         that matches a name but lacks the stamp = Fred's, NEVER deleted).
      c) the delete rule: owned + stamped + not in this Send's payload + NOT referenced by any other param expression or
         by a feature/sketch dimension outside what this Send rebuilds → delete; anything referenced → keep + log why.
      d) ordering vs the rebuild (delete after the new sketches exist? before?), undo story in Fusion, dry-run/log output
         (last_send.json gets a "stale_params" section), and what Fred sees.
      e) the tests (pytest shim: declared list, stamp check, reference guard, dry-run) + the live-check script for Fred.
      f) open questions for Fred, each with a recommended default.
- [ ] [R3-item-3] Add a ROADMAP entry pointer (new line under the existing stale-param/queue entry — don't rewrite others').

## Gate
Docs only — no test run needed beyond `git diff --stat` showing only .md files.

## Finish
Commit by path, `git pull --rebase`, push main. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R3 — <sha>"`.
