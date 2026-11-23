#!/bin/bash
# install-bspline-addin.command -- installs the bspline-frame-builder add-in for Autodesk Fusion (macOS).
# No admin rights needed: it writes only to your own Fusion AddIns folder.
#
# Easiest (no download warning): open Terminal and paste
#     curl -fsSL https://bspline-generator.pages.dev/install-bspline-addin.command | bash
# Or, after downloading this file:  bash ~/Downloads/install-bspline-addin.command
#
# Testing: BSPLINE_ADDINS_DIR (or the first argument) installs somewhere else; BSPLINE_ZIP_URL / BSPLINE_SHA256_URL
# override the download.
# Keep these steps in step with fb_shared/updater.py and install-bspline-addin.cmd.
# Exit codes: 0 installed | 1 unexpected error | 2 download failed (offline?) | 3 Fusion AddIns folder not found
#             4 checksum mismatch | 5 not the add-in zip | 6 files in use (close Fusion)

set -u
NAME="bspline-frame-builder"
RELEASE_BASE="https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/"
ZIP_URL="${BSPLINE_ZIP_URL:-${RELEASE_BASE}${NAME}.zip}"
SHA_URL="${BSPLINE_SHA256_URL:-${ZIP_URL}.sha256}"
if [ "${1:-}" != "" ]; then BSPLINE_ADDINS_DIR="$1"; fi
OVERRIDE="${BSPLINE_ADDINS_DIR:-}"
ADDINS="${BSPLINE_ADDINS_DIR:-$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns}"

TMP=""
STAGING=""
cleanup() {
  [ -n "$STAGING" ] && [ -d "$STAGING" ] && rm -rf "$STAGING"
  [ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP"
}
fail() {  # fail <code> <message>
  echo "" >&2
  echo "ERROR: $2" >&2
  cleanup
  exit "$1"
}
trap 'cleanup' EXIT

echo "Installing the $NAME add-in for Autodesk Fusion"
echo "  into $ADDINS"

# 1. the Fusion AddIns folder (Fusion makes API/ on first start; AddIns/ inside it may still be missing)
if [ ! -d "$ADDINS" ]; then
  if [ -z "$OVERRIDE" ] && [ -d "$(dirname "$ADDINS")" ]; then
    mkdir "$ADDINS" || fail 3 "Could not create $ADDINS"
  else
    fail 3 "The Fusion AddIns folder was not found: $ADDINS
       Install Autodesk Fusion and start it once, then run this again."
  fi
fi

for u in "$ZIP_URL" "$SHA_URL"; do
  case "$u" in https://*|file:*) ;; *) fail 2 "Refusing a non-https download: $u" ;; esac
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/bspline-install.XXXXXX")" || fail 1 "Could not make a temp folder."
ZIP="$TMP/$NAME.zip"
SHA="$TMP/$NAME.zip.sha256"

# 2. download the zip and its published checksum
echo "Downloading the checksum..."
curl -fsSL --proto '=https,file' -A "bspline-frame-builder-installer" -o "$SHA" "$SHA_URL" \
  || fail 2 "The download failed. Are you online? ($SHA_URL)"
echo "Downloading the add-in (about 40 MB)..."
curl -fL --progress-bar --proto '=https,file' -A "bspline-frame-builder-installer" -o "$ZIP" "$ZIP_URL" \
  || fail 2 "The download failed. Are you online? ($ZIP_URL)"

# 3. checksum
WANT="$(grep -oE '[0-9a-fA-F]{64}' "$SHA" | head -1 | tr 'A-F' 'a-f')"
[ -n "$WANT" ] || fail 4 "The published checksum file is not readable ($SHA_URL)."
if command -v shasum >/dev/null 2>&1; then
  GOT="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
else
  GOT="$(sha256sum "$ZIP" | awk '{print $1}')"
fi
[ "$GOT" = "$WANT" ] || fail 4 "The download does not match its published checksum (damaged download, or the release is being updated). Try again in a minute."
echo "Checksum OK (${GOT:0:12}...)"

# 4. is it the add-in? one top folder bspline-frame-builder/ with the .py + .manifest, nothing outside it
NAMES="$(unzip -Z1 "$ZIP" 2>/dev/null)" || fail 5 "The download is not a zip file."
while IFS= read -r n; do
  [ -z "$n" ] && continue
  case "$n" in "$NAME"/*) ;; *) fail 5 "The zip has an unexpected entry: $n" ;; esac
  case "/$n/" in */../*|*:*) fail 5 "The zip has an unexpected entry: $n" ;; esac
done <<EOF
$NAMES
EOF
for req in "$NAME/$NAME.py" "$NAME/$NAME.manifest"; do
  printf '%s\n' "$NAMES" | grep -Fxq "$req" || fail 5 "The zip is missing $req."
done

# 5. extract next to the add-in (same disk, so the swap is a rename); a short staging name, as on Windows
STAMP="$(date +%Y%m%d-%H%M%S)"
STAGING="$ADDINS/bsfb-new"
[ -e "$STAGING" ] && rm -rf "$STAGING"
mkdir "$STAGING" || fail 1 "Could not write in $ADDINS"
unzip -q "$ZIP" -d "$STAGING" || fail 5 "The zip could not be extracted."
STAGED="$STAGING/$NAME"

# 6. run on startup (the manifest's own key)
MF="$STAGED/$NAME.manifest"
if grep -Eq '"runOnStartup"[[:space:]]*:[[:space:]]*(true|false)' "$MF"; then
  sed -E 's/("runOnStartup"[[:space:]]*:[[:space:]]*)(true|false)/\1true/' "$MF" > "$MF.tmp" && mv "$MF.tmp" "$MF"
else
  awk 'BEGIN{d=0} { if (!d) { i = index($0, "{"); if (i) { print substr($0, 1, i); print "    \"runOnStartup\": true,";
       r = substr($0, i + 1); if (r != "") print r; d = 1; next } } print }' "$MF" > "$MF.tmp" && mv "$MF.tmp" "$MF"
fi

# 7. back up the old install, swap the new one in
LIVE="$ADDINS/$NAME"
BACKUP=""
if [ -e "$LIVE" ]; then
  [ -f "$LIVE/.addin-running.lock" ] && cp "$LIVE/.addin-running.lock" "$STAGED/"
  BACKUP="$ADDINS/$NAME.bak-$STAMP"
  k=1
  while [ -e "$BACKUP" ]; do k=$((k + 1)); BACKUP="$ADDINS/$NAME.bak-$STAMP-$k"; done
  mv "$LIVE" "$BACKUP" || fail 6 "Files in $LIVE are in use. Quit Fusion, then run this again."
  echo "Backed up the old version to $(basename "$BACKUP")"
fi
if ! mv "$STAGED" "$LIVE"; then
  [ -n "$BACKUP" ] && mv "$BACKUP" "$LIVE"
  fail 6 "Could not move the new version into place; the old one is back. Quit Fusion and try again."
fi

# 8. keep only the newest backup
KEEP=""
[ -n "$BACKUP" ] && KEEP="$(basename "$BACKUP")"
LAST=""
for b in "$ADDINS/$NAME".bak-*; do [ -d "$b" ] && LAST="$(basename "$b")"; done
[ -z "$KEEP" ] && KEEP="$LAST"
for b in "$ADDINS/$NAME".bak-*; do
  [ -d "$b" ] || continue
  [ "$(basename "$b")" = "$KEEP" ] || rm -rf "$b" \
    || echo "Note: could not remove the old backup $(basename "$b"); delete it by hand if you like."
done

VERSION=""
if [ -f "$LIVE/build-info.json" ]; then
  v="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$LIVE/build-info.json" | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"
  s="$(grep -oE '"sha"[[:space:]]*:[[:space:]]*"[^"]*"' "$LIVE/build-info.json" | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"
  [ -n "$v" ] && VERSION=" $v ($s)"
fi
echo ""
echo "Installed $NAME$VERSION."
echo "It is set to run each time Fusion starts."
echo "Next: restart Fusion -- or, in Fusion, open Utilities > Add-Ins (Shift+S),"
echo "      pick $NAME on the Add-Ins tab and click Run."
exit 0
