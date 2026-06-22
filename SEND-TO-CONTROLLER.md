# Post & Send — Integration Plan

A custom **Post & Send** palette in the Fusion add-in that mirrors the native Post Process window but sends the result directly to the DDCS controller via the bridge gateway instead of saving to disk.

## How the existing transport works (Studio → Controller)

```
Studio UI  →  POST /api/jobs {name, nc, map}  →  bridge gateway
                                               →  transfer.py: deliver() → CNCDISK
                                               →  User presses Cycle Start
```

`POST /api/jobs` accepts `{ name, nc, map? }`, returns `{ jobId, name, tracked }`. No auth, local only.

## Palette UI

A sibling to Fusion's native post window. Two tabs: **Send** and **Beacons**.

### Tab 1 — Send

| Field | Behaviour |
|---|---|
| **Setup** | Dropdown — all setups in the active document |
| **Post processor** | Dropdown — all `.cps` from `genericPostFolder` + `personalPostFolder`, default = `fanuc_DDCS_m350` |
| **Program name** | Text input, defaults to the selected setup name |
| **Gateway** | Status chip — polls `GET /api/descriptor`, shows connected / offline |
| **Post & Send** | Primary button — disabled when gateway offline |

### Tab 2 — Beacons

Same controls as the Studio Gateway → Send tab. Beacons are optional — the user can send deliver-only (no tracking) or tracked.

| Control | Behaviour |
|---|---|
| **Enable beacons** | Toggle — off = deliver-only, on = tracked |
| **Count** | Max beacons 1–255 (default 255) |
| **Pacing** | `by time` (wall-clock estimate) or `by line count` |
| **Advanced** | Collapsed by default: counter var (#250), marker var (#251), marker value (111) — rarely changed, the frame is proven on hardware |
| **Preview** | After post-process: estimated job time + how many beacons will be inserted |

#### How beacons work (from Studio `instrument.js`)

Beacons are injected at **Z-up moves** (tool retracts) — not at operation boundaries. Three lines inserted per beacon:

```
#251 = 111                    ← marker flag (once, before first beacon)
#250 = N                      ← beacon counter (increments per beacon)
MSETDATA[250,1,0,2,16,300]   ← writes N to Modbus register; gateway reads it back
```

The gateway tracks progress by polling the Modbus register. The map records `{ n, line, op, cum_time_s, percent }` per beacon.

#### Open hardware question — do beacons stall the motors?

`MSETDATA` is a Modbus write. On complex Fusion toolpaths (morphed passes, adaptive clearing, smooth 3D surfaces) any lookahead-buffer flush or motion pause at a beacon would leave a mark. **This needs to be tested on the machine before enabling beacons by default for Fusion files.**

Test plan:
1. Generate a simple Fusion toolpath (flat pocket, known feedrate)
2. Instrument it with 5–10 beacons
3. Run on the machine and observe: any hesitation, mark on surface, or feedrate dip at beacon lines?
4. If stall detected: consider inserting beacons only at **full retracts to safe Z** (G0 Z[safe]) rather than all Z-ups, reducing frequency

Until tested, the palette should default beacons to **off** for Fusion files (unlike Studio where they're on by default).

## Verified API path (live-tested in Fusion)

```python
import adsk.cam, tempfile, os, urllib.request, json

def get_cam():
    for i in range(app.activeDocument.products.count):
        c = adsk.cam.CAM.cast(app.activeDocument.products.item(i))
        if c:
            return c

def list_setups(cam):
    return [{"name": cam.setups.item(i).name, "index": i}
            for i in range(cam.setups.count)]

def list_posts(cam):
    posts = []
    for folder in [cam.genericPostFolder, cam.personalPostFolder]:
        if folder and os.path.exists(folder):
            for f in os.listdir(folder):
                if f.endswith('.cps'):
                    posts.append({"name": f[:-4], "path": folder + '/' + f})
    return posts

def post_and_capture(cam, setup_index, cps_path, program_name):
    setup = cam.setups.item(setup_index)
    tmp = tempfile.mkdtemp().replace('\\', '/')
    post_input = adsk.cam.PostProcessInput.create(
        program_name,
        cps_path,
        tmp,
        adsk.cam.PostOutputUnitOptions.DocumentUnitsOutput
    )
    ok = cam.postProcess(setup, post_input)
    if not ok:
        raise RuntimeError("postProcess failed")
    files = [f for f in os.listdir(tmp) if f.endswith('.nc')]
    if not files:
        raise RuntimeError("No .nc output generated")
    with open(os.path.join(tmp, files[0]), 'r', errors='replace') as f:
        return f.read()

def gateway_status(url="http://localhost:8765"):
    try:
        with urllib.request.urlopen(f"{url}/api/descriptor", timeout=2) as r:
            return json.loads(r.read()).get("controller_connected", False)
    except Exception:
        return False

def send_to_gateway(nc_text, name, url="http://localhost:8765"):
    payload = json.dumps({"name": name, "nc": nc_text}).encode()
    req = urllib.request.Request(f"{url}/api/jobs", data=payload,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())
```

**Key finding from live test**: `cam.genericPostFolder + '/fanuc_DDCS_m350.cps'` exists and works. The API enum is `adsk.cam.PostOutputUnitOptions.DocumentUnitsOutput` (not `PostProcessOutputUnitOptions`).

## Palette HTML (outline)

```html
<select id="setup-select"></select>
<select id="post-select"></select>
<input id="program-name" type="text">
<div id="gateway-chip">⬤ checking...</div>
<button id="btn-send" disabled>Post & Send</button>
<div id="status"></div>

<script>
window.fusionMessageReceived = ({ action, data }) => {
  const d = JSON.parse(data);
  if (action === "init") {
    document.getElementById("setup-select").innerHTML =
      d.setups.map(s => `<option value="${s.index}">${s.name}</option>`).join("");
    document.getElementById("post-select").innerHTML =
      d.posts.map(p => `<option value="${p.path}"${p.name.includes('DDCS') ? ' selected' : ''}>${p.name}</option>`).join("");
    document.getElementById("program-name").value = d.setups[0]?.name ?? "";
  }
  if (action === "gatewayStatus") {
    const ok = d.connected;
    document.getElementById("gateway-chip").textContent = ok ? "⬤ Connected" : "⬤ Offline";
    document.getElementById("btn-send").disabled = !ok;
  }
  if (action === "sendResult") {
    document.getElementById("status").textContent =
      d.jobId ? "Sent — press Cycle Start at the machine." : "Send failed.";
  }
};

document.getElementById("setup-select").addEventListener("change", e => {
  document.getElementById("program-name").value =
    e.target.options[e.target.selectedIndex].text;
});

document.getElementById("btn-send").addEventListener("click", () => {
  adsk.fusionSendData("postAndSend", JSON.stringify({
    setupIndex: parseInt(document.getElementById("setup-select").value),
    cpsPath: document.getElementById("post-select").value,
    programName: document.getElementById("program-name").value,
  }));
});
</script>
```

## Python event handler

```python
# On palette open — push init data + start gateway poll
cam = get_cam()
palette.sendInfoToHTML("init", json.dumps({
    "setups": list_setups(cam),
    "posts": list_posts(cam),
}))
palette.sendInfoToHTML("gatewayStatus", json.dumps({
    "connected": gateway_status()
}))

# On postAndSend message from HTML
if command_id == "postAndSend":
    args = json.loads(data)
    cam = get_cam()
    nc = post_and_capture(cam, args["setupIndex"], args["cpsPath"], args["programName"])
    # TODO: inject beacons here
    result = send_to_gateway(nc, args["programName"])
    palette.sendInfoToHTML("sendResult", json.dumps(result))
```

## File layout

```
bspline-frame-builder/
  post-and-send/               ← new standalone palette (sibling to CAM-builder)
    post-and-send.py           ← add-in entry: registers command + palette
    post-and-send.manifest
    sender.py                  ← post_and_capture, send_to_gateway, gateway_status
    html/
      index.html               ← palette UI
```

## What stays unchanged

- `bridge/` — zero changes; `POST /api/jobs` already handles this.
- DDCS Studio — zero changes.

## Decisions made

- **UX**: sibling to native Fusion post window — same mental model, destination is controller not disk.
- **Setup selection**: manual dropdown.
- **Post picker**: shows all `.cps` from both post folders, defaults to `fanuc_DDCS_m350`.
- **Program name**: editable, auto-fills from selected setup name.
- **Post & Send is one step**: `cam.postProcess()` runs silently to temp, output read, beacons injected, sent to gateway.
- **No bundled `.cps`**: uses Fusion's own cached post at `cam.genericPostFolder + '/fanuc_DDCS_m350.cps'`.
- **Architecture (D)**: Fusion add-in and Studio are independent clients of the same gateway.

## Open questions

- Beacon injection: **done client-side in the add-in** (`sender.py`). Palette injects `(BEACON:id:label)` comments into the NC text at the right lines, builds the map, then sends `{ name, nc_already_beaconed, map }`. Gateway accepts a file that already has its map — it just tracks, doesn't inject.
- Anchor strategy: DDCS post emits `(OP_NAME)` comments — confirm these are consistent enough to be reliable beacon anchors across all setup types.
- Gateway port: hardcode `8765` or expose as a settings field in the palette?
- Should this live inside the existing `b-spline-generator-web-addin` or as a standalone add-in?
