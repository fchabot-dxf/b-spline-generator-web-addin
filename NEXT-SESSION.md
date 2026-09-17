# NEXT — IN3b: the inspector overflow is a FLOATING-palette rendering quirk — declare the dock like b-spline does

**Ball: worker (seat A) · epoch 1 · IN3b.** File: ONLY `bspline-frame-builder/frame-inspector/fusion-inspector.py`.
One commit by path, predicted **1 file, +3 lines**.

## Ground truth (advisor, live Fusion 2026-09-17 10:35, deployed 4eb3efc = your IN3)
- IN3's flex→float change did NOT remove the overflow (recaptured at 320 and 520: still clipped). Your honesty note was
  right: it was not the cause. Keep the float version anyway — it renders fine.
- Measured: DPI 96; the palette HWND client area is exactly 520×760; no child windows. So the page really was laid out
  wider than its CSS viewport — but only while the palette FLOATS (`dockingState` 0, the creation default at
  `fusion-inspector.py:332` `ui.palettes.add(PALETTE_ID, 'Fusion Inspector', PALETTE_URL, True, True, True, 320, 600)`).
  A floating Fusion palette renders its page at a larger zoom (the floating captures show ~1.4× text) inside a viewport
  narrower than the window, hence the proportional overflow.
- **Docked right (`p.dockingState = PaletteDockStateRight`), the same page fits exactly**: bridge badge, Full Copy, Copy
  Name and the ⧉ row buttons all visible (scratchpad `in3-docked.png`). The b-spline palette never shows the problem
  because `b-spline-gen.py:1458` declares `palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight`
  right after `palettes.add`.

## Do
Right after the `palettes.add(...)` at `:332`, mirror b-spline:
```python
            # Dock right like the B-Spline palette (b-spline-gen.py:1458). A FLOATING
            # Fusion palette renders its page zoomed inside a narrower viewport and
            # clips the right column (IN3, measured live 2026-09-17); docked, it fits.
            palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
```
Nothing else. (The user can still undock it by hand; the default is what matters.)

## Verify
`py_compile`; `grep -n dockingState fusion-inspector.py` → 1; `git show --stat HEAD` → 1 file. Live proof is the
advisor's (deploy through the bridge, open the inspector fresh, capture).

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "IN3b: inspector palette docks right on creation (mirrors b-spline-gen.py:1458) — <sha>, 1 file. Next: CW1."`
and stop.
