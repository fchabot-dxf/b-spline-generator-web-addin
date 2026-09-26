# NEXT (fb-app) — F4: FB-FIX — two live Frame Builder bugs + "board too small" warning

**Ball: worker (seat C) · epoch 1 · F4.** F3 (c060eaf) accepted. Spec: ROADMAP.md on main "FB-FIX". PROGRESS automatic
("F4 item N: …"). FUSION: NOT yet — do items 1-3 with the shim first; ask the advisor for a Fusion window for item 4
(Fred may be using Fusion). GATE 3.2 (shape handles) is with Fred — don't build handles.

## Checklist
- [ ] [F4-item-1] resolve_val: unit-suffixed values ('0.75 in', '19 mm') resolve correctly via ONE declared resolver
      (Fusion expression/unit evaluation when available; a tested parser in the shim); never silently 0 — a failed
      resolve is an error the build reports.
- [ ] [F4-item-2] addOffset2: fix the call (correct curve collection type/API) so the offset for sketch 1/3 is
      PARAMETRIC (driven by frame_thickness); keep the non-parametric fallback only as a reported, logged last resort.
- [ ] [F4-item-3] "Board too small for this frame": declared check (safe-zone < 2 x frame_thickness -> 0 bars) surfaced
      as a clear warning (engine log + a value the app can show); unit tests incl. the 5.51x1.97 golden.
- [ ] [F4-item-4] (Fusion window, ask first) verify live: '0.75 in' resolves; changing frame_thickness in Fusion
      updates the frame; re-record the 4 healthy goldens if anything moved.
Commit by path, push origin fb-app, pass back from the fb-app root.
