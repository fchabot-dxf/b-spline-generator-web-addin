# NEXT — seat A — H16: unsaved-changes shown ON the Save (disk) button, not a lone dot

**Ball: worker (seat A) · epoch 3 · H16.** H15 ACCEPTED (c185d7e). NO FUSION. Fred (phone, pointing at "‹ •" in the header): "what is the
point [dot] for?" -> "it should be signalled by the save (disk) button". The "‹" is the apploader's launcher button (fred-host.js,
injected: not ours, leave it). The "•" is #dirty-dot (main/cloud-project-manager.js ~l.177). PROGRESS: commit subjects "H16 item N: …".

## Checklist
- [ ] [H16-item-1] (Fred: "no, just a colour vs grey") The Save (disk) icon is in its normal COLOUR when there are unsaved changes and
      GREYED (like disabled Redo) when saved; still clickable; title "Save" / "Saved". One source of truth: the dirty flag
      cloud-project-manager already tracks. No badge dot.
- [ ] [H16-item-2] REMOVE #dirty-dot from the header (a removal: no orphan CSS/ids/tests; rewrite any test that checked it to check the Save
      badge instead). Keep #fmCurrentFileLabel as is.
- [ ] [H16-item-3] Tests (dirty -> badge on, save -> off, load -> off) + shots at 390 + 1366 (dirty and clean).
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H16 — <shas>"`.
