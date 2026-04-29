---
name: ndoo
description: "Practical guide to using the ndoo/fusion360-mcp-bridge MCP for Fusion 360 add-in development. Use this skill any time the user mentions ndoo, the Fusion MCP bridge, fusion_execute, fusion_screenshot, or wants to probe / verify / introspect the live Fusion 360 API to combat LLM hallucination. Trigger especially when: developing or debugging a Fusion add-in, verifying an API method exists or returns what's expected, enumerating parameters or enum strings on live setups/operations/sketches, capturing viewport screenshots for visual verification, or planning a workflow that uses the bridge as a closed-loop verification surface. Covers install (PowerShell scripts in the workspace root) and common-use patterns (READ-only probes, MUTATE scripts, screenshot pairing, the verify-before-encode loop). Cross-reference with fusion360-api skill for API gotchas the bridge can help verify."
---

# ndoo Fusion 360 MCP Bridge — Install & Common Use

`ndoo/fusion360-mcp-bridge` is a thin MCP wrapper that exposes two tools to
Claude:

| Tool | What it does |
|------|--------------|
| `fusion_execute(script)` | Run any Python inside Fusion's process with full `adsk.*` API access. Use `print()` to return data. Exceptions come back with tracebacks. |
| `fusion_screenshot(direction, width, height)` | Capture the active viewport as a base64 PNG. Camera presets: `current`, `front`, `back`, `left`, `right`, `top`, `bottom`, `iso-top-right`/`-left`/`bottom-right`/`bottom-left`. |

**Why this skill exists:** the bridge's value isn't natural-language CAD — it's
a *closed-loop verification surface against the live API*. LLMs hallucinate
method names, parameter types, and enum strings constantly when working with
Fusion's API. Probing the live runtime via `fusion_execute` is the antidote.
Use it whenever you're tempted to *guess* at an API behaviour during add-in
development.

---

## Install (one-time)

Two install scripts live at the workspace root —
`install-fusion-mcp-bridge.ps1` and `install-fusion-mcp-extension.ps1` (with
the manifest JSON sidecar). Paths assume the bridge clone is at
`C:\Users\danse\APPS\fusion360-mcp-bridge`. Run from PowerShell:

```powershell
cd C:\Users\danse\APPS\b-spline-generator-web-addin

# Stage 1: pip deps + secret + Fusion add-in deploy + Claude config merge
powershell -ExecutionPolicy Bypass -File .\install-fusion-mcp-bridge.ps1

# Stage 2: Cowork extension manifest (Cowork doesn't read the JSON config
#          directly, only the Extensions system; this stages a DXT manifest
#          inside the bridge clone so "Install Unpacked Extension" works)
powershell -ExecutionPolicy Bypass -File .\install-fusion-mcp-extension.ps1
```

Then, in Cowork:

1. **Settings → Extensions → Install Unpacked Extension → select**
   `C:\Users\danse\APPS\fusion360-mcp-bridge`. Cowork reads `manifest.json`
   from that folder and registers the MCP server.
2. **Restart Cowork** (full quit, including system tray).
3. **In Fusion 360**: the `FusionMCPBridge` add-in is set to
   `runOnStartup=true`, so it loads automatically next launch. If Fusion was
   already running, open `Tools → Add-Ins` (Shift+S) → My Add-Ins →
   FusionMCPBridge → Run.

**Verify the install:** ask Claude to call `fusion_execute` with a sanity
probe (see "First probe" below). If it returns Fusion's version and the
active document name, the loop is closed.

**Two daemons, both required at runtime:**

```
Cowork ←→ ndoo MCP server (Python, on demand) ←→ HTTP localhost:7654 ←→ FusionMCPBridge add-in (running inside Fusion) ←→ Fusion API
```

If the bridge add-in isn't running inside Fusion, the MCP server can't reach
Fusion. If Cowork hasn't loaded the extension, the MCP server isn't being
launched. Check both before troubleshooting deeper.

---

## First probe (always start here)

Before running any new add-in workflow against ndoo, run this sanity probe to
confirm what state Fusion is in. The answers shape every subsequent decision:

```python
import adsk.core, adsk.fusion, adsk.cam

app = adsk.core.Application.get()
ui = app.userInterface

print(f"Fusion: {app.version}")
print(f"Workspace: {ui.activeWorkspace.id if ui.activeWorkspace else '<none>'}")
print(f"Document: {app.activeDocument.name if app.activeDocument else '<none>'}")
print(f"activeProduct.objectType: {app.activeProduct.objectType if app.activeProduct else '<none>'}")

doc = app.activeDocument
if doc:
    for p in doc.products:
        print(f"  - productType={p.productType}  objectType={p.objectType}")
```

Why this matters: `app.activeProduct` returns a different type depending on
which workspace is active (`Design` in design workspace, `CAMProduct` in
manufacture). A whole class of CAM-related bugs comes from code that assumed
`activeProduct` is always a `Design` cast. The probe surfaces that immediately.

---

## The verify-before-encode loop

This is the core working pattern when developing add-ins with the bridge:

1. **Draft.** Claude (or you) writes a candidate API call.
2. **Probe.** Before encoding the call into the add-in source, send a
   READ-only `fusion_execute` script that exercises the same API path against
   the live Fusion. Print intermediate values, types, and any
   collection counts.
3. **Confirm.** If the probe matches expectations, encode it. If it doesn't,
   either the API isn't what we thought (correct the draft) or our document
   isn't in the state we thought (correct the document, then re-probe).
4. **Encode.** Now write it into the add-in's source files. The encoded form
   should match what worked in the probe — same arguments, same paths.

The key discipline: **never let an unverified API call land in the add-in
source**. Every method, every parameter name, every enum string should have
been printed back from a successful `fusion_execute` first.

### Example: verifying enum strings (real case from this codebase)

Drafting `setup.parameters.itemByName('job_stockMode').expression = "'relativebox'"`
based on Autodesk samples is a guess. Verify before encoding:

```python
import adsk.core, adsk.cam
app = adsk.core.Application.get()
cam = adsk.cam.CAM.cast(app.activeProduct)

# Find a real Setup
if cam and cam.setups.count > 0:
    setup = cam.setups.item(0)
    p = setup.parameters.itemByName('job_stockMode')
    print(f"name={p.name}  current={p.value.value!r}  choices={list(p.value.choices) if hasattr(p.value, 'choices') else '<no choices attr>'}")
    # Try the candidate expressions and see which one Fusion accepts
    for cand in ['relativebox', 'relativeBox', 'fixedbox', 'fromsolid', 'previoussetup']:
        try:
            p.expression = "'" + cand + "'"
            print(f"  {cand!r}: ACCEPTED (current is now {p.value.value!r})")
        except Exception as e:
            print(f"  {cand!r}: REJECTED -- {e}")
```

The output tells you which strings actually work on this Fusion build,
including whether the choices enum is empty (a known quirk on current
builds — see `fusion360-api` skill).

---

## Tagging scripts: READ vs MUTATE

`fusion_execute` runs *inside the user's live document*. There is no sandbox.
A poorly-written probe can corrupt their work. Adopt this discipline:

**READ scripts** only inspect — they call methods that don't change state.
Safe to run repeatedly on any document the user has open. Examples: reading
parameter values, enumerating bodies, casting types, reading collection
counts, capturing screenshots.

**MUTATE scripts** create, modify, or delete entities. Run these only when:
- The user has explicitly asked for an action that requires mutation, OR
- A scratch document is open (New Untitled), and the user knows that's where
  the experiments are happening.

Whenever you write a `fusion_execute` script, include a comment header
declaring its tier:

```python
# READ: enumerate setup parameters, no mutations
# or
# MUTATE: creates a sketch + extrude on the XY plane
```

This is a small ceremony but it gates a real foot-gun. The header makes the
script self-documenting and reminds you (and any future LLM) what's at stake
before re-running.

---

## Common-use recipes

### 1. Inspect the design tree

```python
# READ: dump the design's component hierarchy
import adsk.fusion
design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
if design is None:
    # In Manufacture workspace, fall back to the document's Design product
    doc = adsk.core.Application.get().activeDocument
    design = adsk.fusion.Design.cast(doc.products.itemByProductType('DesignProductType'))

def walk(comp, depth=0):
    pad = '  ' * depth
    print(f"{pad}{comp.name}  bodies={comp.bRepBodies.count}  occs={comp.occurrences.count}")
    for occ in comp.occurrences:
        walk(occ.component, depth + 1)

walk(design.rootComponent)
```

### 2. Enumerate parameters on a Setup / Operation / Feature

```python
# READ: dump every parameter on the first setup, sorted by name
import adsk.cam
cam = adsk.cam.CAM.cast(adsk.core.Application.get().activeProduct)
setup = cam.setups.item(0)

names = sorted(p.name for p in setup.parameters)
for name in names:
    p = setup.parameters.itemByName(name)
    try:
        v = p.value.value
    except Exception:
        v = '<unreadable>'
    print(f"  {name:40s}  {v!r}")
```

Replace `setup.parameters` with the parameter collection on whatever object
you're inspecting (`operation.parameters`, `feature.parameters`, etc.).

### 3. Probe a method's return shape before relying on it

```python
# READ: what does Sketch.project actually return when given a sketch entity?
import adsk.fusion
design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
sk_a = design.rootComponent.sketches.item(0)  # source
sk_b = design.rootComponent.sketches.item(1)  # destination
src = sk_a.sketchCurves.item(0)
result = sk_b.project(src)
print(f"type: {type(result).__name__}")
print(f"count: {result.count}")
for i in range(result.count):
    item = result.item(i)
    print(f"  [{i}] {type(item).__name__}  isValid={item.isValid}")
```

The point isn't the specific question — it's the pattern. When you don't
*know* what a method returns, you ask Fusion directly.

### 4. Visual verification with screenshots

After a `MUTATE` script that's expected to produce visible geometry, pair it
with `fusion_screenshot` to confirm the result *looks* right:

```
fusion_execute(<the mutate script>)
fusion_screenshot(direction="iso-top-right")
```

Look at the result. If the geometry is wrong shape, wrong place, or absent,
the probe revealed an issue. Note: `fusion_screenshot` captures the *current*
viewport — if Fusion is in the wrong view, set the camera in the script
first or use a directional preset.

### 5. Probing CAM enum / choice parameters specifically

CAM `choice` parameters are notoriously fiddly — the strings differ across
builds, the `choices` enum is sometimes empty even on live setups, and the
`expression` form requires an extra layer of quoting. Probe like this:

```python
# READ: what choice strings does this setup accept for wcs_origin_mode?
setup = cam.setups.item(0)
p = setup.parameters.itemByName('wcs_origin_mode')
print(f"current = {p.value.value!r}")
print(f"choices = {list(p.value.choices) if hasattr(p.value, 'choices') and p.value.choices else '<empty>'}")

# If choices is empty, brute-force candidates from Autodesk samples
for cand in ['modelOrigin', 'modelPoint', 'stockPoint', 'boxPoint', 'point', 'selectedPoint']:
    try:
        p.expression = "'" + cand + "'"
        print(f"  {cand!r}: ACCEPTED  (now {p.value.value!r})")
    except Exception as e:
        print(f"  {cand!r}: rejected -- {type(e).__name__}")
```

This pattern produces the verified-string mappings that go into the
`parameter_introspect.py` candidate dictionaries in the CAM Builder — instead
of guessing, ask Fusion.

---

## Failure modes & gotchas

**Tools don't appear in deferred list.** The bridge isn't connected. Check
in order:

1. Is the FusionMCPBridge add-in *running* inside Fusion? Tools → Add-Ins →
   My Add-Ins. Should show a green "Running" indicator.
2. Is Cowork's extension actually loaded? Settings → Extensions → look for
   ndoo / fusion360-mcp-bridge. If it shows "Server disconnected", check
   the developer log for that extension specifically.
3. Restart Cowork (full quit). MCP servers don't always recover from
   transient launch failures.

**`fusion_execute` returns "fusion is busy" or hangs.** Fusion's API runs on
the main thread, marshalled via `CustomEvent`. If a modal dialog is open
(`Save As`, an error dialog, command preview), the event loop is blocked.
Close the dialog and retry. Long-running scripts (>5s) will also block the
Fusion UI for that duration — keep probes short.

**`adsk.fusion.Design.cast(app.activeProduct)` returns None.** You're in
Manufacture workspace, not Design. Use the workspace-aware fallback shown
in recipe #1 (`itemByProductType('DesignProductType')`). This is documented
in detail in the CAM Builder's `cam_utils/get_design.py`.

**Modifications appear, then disappear on retry.** Likely undo. Check
Fusion's timeline / Edit menu for an entry left over from a previous probe.
Direct-mode documents accumulate state silently; parametric documents leave
timeline breadcrumbs.

**The screenshot is black or blank.** Fusion's viewport hasn't rendered yet,
the camera is inside geometry, or all bodies are hidden. Run a viewport-
fitting script first:

```python
# READ: fit all bodies to view
ui = adsk.core.Application.get().userInterface
cmd = ui.commandDefinitions.itemById('FitCommand')
if cmd:
    cmd.execute()
```

Then re-screenshot.

---

## When to reach for `fusion_execute` vs another tool

- **Use `fusion_execute`** when you need to verify, introspect, or perform
  arbitrary API operations during add-in development. The full `adsk.*`
  namespace is your toolbox.
- **Use the Fusion add-in's own scripts/commands** for repeated operations
  the user actually wants in production. `fusion_execute` is for the *dev
  loop*; the encoded add-in code is what the user runs day-to-day.
- **Use `BJam/fusion-cam-mcp` (if installed)** for structured parameter
  dumps on existing CAM operations (feeds/speeds/engagement organised by
  category, with computed metrics like chip load). Complementary to
  `fusion_execute`'s raw access — sometimes a structured view is faster
  than a raw probe.
- **Don't reach for the official Autodesk Fusion MCP** for add-in dev work;
  it abstracts the API away behind a curated tool surface, which is the
  wrong layer for verification.

---

## Cross-references

- `fusion360-api` skill — covers the actual API gotchas (retired methods,
  solver crashes, CustomEvent patterns) that the bridge helps verify.
- `bspline-frame-builder/CAM-builder/CAM_API_NOTES.md` — verified CAM API
  patterns produced via this exact verify-before-encode loop.
- `bspline-frame-builder/CAM-builder/CAM_BUILDER_CONTEXT.md` — example of
  how bridge probing fed real fixes in a real add-in (param prop, MM scope,
  stockMode typed enum).
- `fusion360-mcp-bridge/CLAUDE.md` (in the bridge's own repo) — the
  authoritative source on `fusion_execute` semantics, units, revolve rules,
  TBrepM patterns. Keep that file synced to the actual bridge version.

The bridge itself is dumb — the value is the discipline you bring to using
it. Probe before encoding, tag READ vs MUTATE, verify enum strings before
the brittle ones land in source. That's the win.
