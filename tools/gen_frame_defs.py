"""
gen_frame_defs.py — FB-APP S1: generate the app's frame-defs.json from the
frame builder's own Python declarations (one source; never hand-edit the JSON).

    python tools/gen_frame_defs.py           # (re)write the file
    python tools/gen_frame_defs.py --check   # exit 1 if the file is stale

Source: fb_engine/frame_definition.py (common declarations) + every template
folder template_resolver discovers (its template_data.py + phase blocks).
Plain Python, with no Fusion / adsk import.
"""
import hashlib
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
FRAME_BUILDER = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
OUT_PATH = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen", "html", "data", "frame-defs.json")


def source_files():
    """Every file the definition is built from, in a stable order."""
    files = [os.path.join(FRAME_BUILDER, "fb_engine", "frame_definition.py"),
             os.path.join(FRAME_BUILDER, "fb_engine", "parameter_schema.py")]
    sketches = os.path.join(FRAME_BUILDER, "sketches")
    for root, dirs, names in os.walk(sketches):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        files += [os.path.join(root, n) for n in sorted(names) if n.endswith(".py")]
    return files


def source_hash():
    """sha256 over the sources with CRLF normalized, so a checkout's line
    endings never make the file look stale."""
    h = hashlib.sha256()
    for path in source_files():
        rel = os.path.relpath(path, FRAME_BUILDER).replace("\\", "/")
        with open(path, "rb") as f:
            h.update(rel.encode() + b"\0" + f.read().replace(b"\r\n", b"\n") + b"\0")
    return h.hexdigest()


def render():
    if FRAME_BUILDER not in sys.path:
        sys.path.insert(0, FRAME_BUILDER)
    from fb_engine.frame_definition import build_frame_defs
    defs = build_frame_defs(source_hash())
    return json.dumps(defs, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv):
    text = render()
    current = None
    if os.path.exists(OUT_PATH):
        with open(OUT_PATH, encoding="utf-8") as f:
            current = f.read().replace("\r\n", "\n")
    if "--check" in argv:
        if current != text:
            print(f"STALE: {OUT_PATH} -- run: python tools/gen_frame_defs.py")
            return 1
        print("frame-defs.json is fresh")
        return 0
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"wrote {OUT_PATH} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
