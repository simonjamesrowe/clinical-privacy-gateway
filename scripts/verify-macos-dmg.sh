#!/bin/bash
# Check the shipped app, not just the bundle before it was packaged.
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: bash scripts/verify-macos-dmg.sh <one DMG file>" >&2
  exit 2
fi

verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/clinicians-veil-dmg.XXXXXX")
mountpoint="$verification_dir/mounted"
mounted=false

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mountpoint" -quiet || status=1
  fi
  if [[ -d "$mountpoint" ]]; then
    rmdir "$mountpoint" || status=1
  fi
  rmdir "$verification_dir" || status=1
  exit "$status"
}
trap cleanup EXIT

hdiutil verify "$1"
hdiutil attach "$1" -readonly -nobrowse -mountpoint "$mountpoint" -quiet
mounted=true

shopt -s nullglob
apps=("$mountpoint/"*.app)
if [[ ${#apps[@]} -ne 1 ]]; then
  echo "Expected exactly one app bundle in the DMG." >&2
  exit 1
fi

# Ad-hoc signing proves bundle integrity, not Apple identity or notarisation.
# Do not use spctl acceptance as a gate until Developer ID signing is enabled.
codesign --verify --deep --strict --verbose=2 "${apps[0]}"
echo "Packaged app signature verified."
