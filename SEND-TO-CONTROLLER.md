# Send to Controller — Integration Plan

Send a generated toolpath (`.nc` file) from the B-Spline / Frame Builder add-in directly to the DDCS controller via the bridge gateway, reusing the same transport layer DDCS Studio already uses.

## How the existing transport works (Studio → Controller)

```
Studio UI  →  POST /api/jobs {name, nc}  →  bridge gateway (fairy/server.py)
                                          →  transfer.py: deliver(nc_bytes, name)
                                          →  CNCDISK share / expert_dest folder
                                          →  User presses Cycle Start
```

The gateway runs locally on the user's machine. No auth, no cloud required. `POST /api/jobs` accepts `{ name: string, nc: string }` and returns `{ jobId, name, tracked }`.

## Plan

### Step 1 — Export G-code from CAM-builder (already partly wired)

`CAM-builder/cam-builder.py` can already scaffold Fusion CAM operations. The missing piece: run the Fusion post-processor and capture the `.nc` output bytes.

```python
# cam-builder.py (add after setup_builder runs)
import adsk.cam

def post_and_capture(setup, post_config_path, output_path):
    cam = adsk.cam.CAM.cast(adsk.core.Application.get().activeProduct)
    post_input = adsk.cam.PostProcessInput.create(
        output_path, post_config_path, "nc", adsk.cam.PostProcessOutputUnitOptions.DocumentUnitsOutput
    )
    cam.postProcess(setup, post_input)
    with open(output_path, "r") as f:
        return f.read()
```

The post config (`.cps`) to use is the user's DDCS Expert post — ship a default one alongside the add-in, or let the user pick it in the palette UI.

### Step 2 — Send to gateway from the Fusion palette (Python side)

The Fusion add-in already has a Python↔JS bridge via `adsk.core.Palette`. After capturing the `.nc` string:

```python
import urllib.request, json

def send_to_controller(nc_text: str, name: str, gateway_url: str = "http://localhost:8765"):
    payload = json.dumps({"name": name, "nc": nc_text}).encode()
    req = urllib.request.Request(
        f"{gateway_url}/api/jobs",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())
```

Call this after Step 1. No third-party dependencies — uses only stdlib `urllib`.

### Step 3 — Setup picker + Send button in the CAM-builder palette

The user manually picks a CAM Setup from a dropdown, then clicks **Send to Controller**.

On palette open, Python enumerates all setups and pushes the list to the HTML:

```python
# cam-builder.py — on palette show / refresh
import adsk.cam

def list_setups():
    cam = adsk.cam.CAM.cast(adsk.core.Application.get().activeProduct)
    return [{"name": s.name, "index": i} for i, s in enumerate(cam.setups)]

# push to palette
palette.sendInfoToHTML("setups", json.dumps(list_setups()))
```

HTML palette renders a `<select>` populated from that list, plus a **Send to Controller** button:

```html
<!-- cam-builder/html/index.html -->
<label>CAM Setup</label>
<select id="setup-select"></select>
<button id="btn-send">Send to Controller</button>
<div id="send-status"></div>

<script>
window.fusionMessageReceived = ({ action, data }) => {
  if (action === "setups") {
    const setups = JSON.parse(data);
    const sel = document.getElementById("setup-select");
    sel.innerHTML = setups.map(s => `<option value="${s.index}">${s.name}</option>`).join("");
  }
  if (action === "sendResult") {
    document.getElementById("send-status").textContent =
      JSON.parse(data).jobId ? "Sent — press Cycle Start at the machine." : "Send failed.";
  }
};

document.getElementById("btn-send").addEventListener("click", () => {
  const idx = document.getElementById("setup-select").value;
  adsk.fusionSendData("sendToController", JSON.stringify({ setupIndex: parseInt(idx), gatewayUrl: "http://localhost:8765" }));
});
</script>
```

Python handler receives `setupIndex`, retrieves that setup, posts, and captures the result:

```python
# cam-builder.py — palette HTML event handler
if command_id == "sendToController":
    args = json.loads(data)
    cam = adsk.cam.CAM.cast(adsk.core.Application.get().activeProduct)
    setup = cam.setups[args["setupIndex"]]
    nc = post_and_capture(setup, post_cps_path, tmp_nc_path)
    result = send_to_controller(nc, setup.name, args["gatewayUrl"])
    palette.sendInfoToHTML("sendResult", json.dumps(result))
```

### Step 4 — Gateway URL configuration

The gateway port (default `8765`) should be configurable. Options (pick one):

- **Simplest**: hardcode `http://localhost:8765` with a small text field in the palette to override.
- **Better**: read from a `.json` settings file next to the add-in manifest (same pattern Studio uses for bridge config).

### Step 5 — Verify gateway is reachable before send

Before sending, `GET /api/descriptor` and check `controller_connected`. Show a warning if the gateway is offline or the controller is disconnected — same guard Studio's `bridgeTransfer.js` uses.

```python
def gateway_status(gateway_url):
    try:
        with urllib.request.urlopen(f"{gateway_url}/api/descriptor", timeout=2) as r:
            d = json.loads(r.read())
            return d.get("controller_connected", False)
    except Exception:
        return False
```

## File layout (new/changed files)

```
bspline-frame-builder/
  CAM-builder/
    cam-builder.py          ← add post_and_capture() + send_to_controller() + handler
    cam_engine/
      sender.py             ← new: isolated send_to_controller() + gateway_status()
    html/
      index.html            ← add Send to Controller button + toast display
```

## What stays unchanged

- `bridge/` — gateway needs zero changes; `POST /api/jobs` already handles this.
- `transfer.py` — unchanged.
- DDCS Studio — unchanged.

## Open questions

- Which `.cps` post file to ship (Expert/Generic)? Probably ship the same post Studio's CAM builder uses.
- Gateway port: hardcode `8765` for now or expose in palette settings?

## Decisions made

- **Setup selection**: manual — user picks from a dropdown in the palette, not auto-detected.
