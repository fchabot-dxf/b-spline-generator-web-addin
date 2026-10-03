"""
tools/add_photo_pattern.py — F34 item 1: add one photo to the built-in
Photo-filter pattern row (data/photo-patterns.json). Run once per new photo
(Fred keeps adding them, the advisor runs this for each one) -- "adding a
pattern is data only, no code change" (dispatch's own ask: the app reads
this JSON at runtime, core/photo/patterns.js's own loadPhotoPatterns()).

Usage: python tools/add_photo_pattern.py <photo_path> <display name>

Writes:
  bspline-frame-builder/b-spline-gen/html/data/photo-patterns/<id>.jpg
    (full working image, downscaled)
  bspline-frame-builder/b-spline-gen/html/data/photo-patterns/<id>_thumb.jpg
    (small thumbnail, for the pattern-row UI)
  bspline-frame-builder/b-spline-gen/html/data/photo-patterns.json
    (one entry added, with NEUTRAL settings -- Fred and the advisor tune
    each pattern live afterward; this script never guesses good values)

Re-running with the same name is idempotent: the existing entry (matched by
id, a slug of the name) is replaced in place, not duplicated.
"""
import json
import os
import re
import sys

from PIL import Image, ImageOps

REPO = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
DATA_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen", "html", "data")
IMAGES_DIR = os.path.join(DATA_DIR, "photo-patterns")
PATTERNS_JSON = os.path.join(DATA_DIR, "photo-patterns.json")

# Same cap as core/photo/codec.js's own PHOTO_MAX_DIM -- the app downscales
# to this on decode anyway, so shipping anything bigger only bloats the repo.
# Keep the two in sync by hand (cross-language constant, same convention as
# this project's own item-18/49 closed-form pairs) if either ever changes.
MAX_DIM = 512
THUMB_DIM = 120
JPEG_QUALITY = 80

# A fully neutral starting point -- "ship the raw photo + neutral settings"
# (Fred: don't tune on your own; he and the advisor tune each preset live,
# then freeze the approved values here). None for crop/levels means "no
# such edit step at all" (core/photo/patterns.js's own settingsToPhotoEdits
# convention), not a no-op step at default values.
NEUTRAL_SETTINGS = {
    "crop": None, "rotate": 0, "flip": {"h": False, "v": False},
    "levels": None, "brightness": 0, "contrast": 0, "blur": 0, "invert": False,
    "depth": 1.0, "scale": 1.0, "offsetX": 0.0, "offsetY": 0.0, "rotation": 0, "repeat": 0,
}


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return s or "pattern"


def resized(img, max_dim):
    w, h = img.size
    scale = min(1.0, max_dim / max(w, h))
    if scale >= 1.0:
        return img
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 1
    photo_path, name = argv
    if not os.path.isfile(photo_path):
        print(f"no such file: {photo_path}")
        return 1

    pattern_id = slugify(name)
    os.makedirs(IMAGES_DIR, exist_ok=True)

    img = Image.open(photo_path)
    # EXIF orientation: real camera/phone JPEGs often carry a rotation tag
    # that PIL does NOT auto-apply on load -- without this, a photo shot in
    # portrait can land sideways once its own EXIF tag is stripped by the
    # resize/re-encode below.
    img = ImageOps.exif_transpose(img).convert("RGB")

    full = resized(img, MAX_DIM)
    thumb = resized(img, THUMB_DIM)

    full_path = os.path.join(IMAGES_DIR, f"{pattern_id}.jpg")
    thumb_path = os.path.join(IMAGES_DIR, f"{pattern_id}_thumb.jpg")
    full.save(full_path, "JPEG", quality=JPEG_QUALITY)
    thumb.save(thumb_path, "JPEG", quality=JPEG_QUALITY)

    entry = {
        "id": pattern_id,
        "name": name,
        "image": f"data/photo-patterns/{pattern_id}.jpg",
        "thumb": f"data/photo-patterns/{pattern_id}_thumb.jpg",
        "settings": dict(NEUTRAL_SETTINGS),
    }

    patterns = []
    if os.path.exists(PATTERNS_JSON):
        with open(PATTERNS_JSON, encoding="utf-8") as f:
            patterns = json.load(f)
    patterns = [p for p in patterns if p.get("id") != pattern_id]
    patterns.append(entry)

    with open(PATTERNS_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(patterns, f, indent=2)
        f.write("\n")

    print(f"wrote {full_path} ({os.path.getsize(full_path)} bytes)")
    print(f"wrote {thumb_path} ({os.path.getsize(thumb_path)} bytes)")
    print(f"updated {PATTERNS_JSON} ({len(patterns)} pattern(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
