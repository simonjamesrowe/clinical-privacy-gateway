#!/bin/bash
# Check the shipped app, not just the bundle before it was packaged.
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: bash scripts/verify-macos-dmg.sh <one DMG file>" >&2
  exit 2
fi

verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/clinicians-veil-dmg.XXXXXX")
mountpoint="$verification_dir/mounted"
entitlements="$verification_dir/entitlements.plist"
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
  rm -f "$entitlements"
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
app="${apps[0]}"
codesign --verify --deep --strict --verbose=2 "$app"
echo "Packaged app signature verified."

# Dictation: without the usage string TCC terminates the app on first microphone access, and
# without the entitlement the hardened runtime delivers no audio and shows no prompt.
if ! /usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "$app/Contents/Info.plist" >/dev/null; then
  echo "The app has no microphone usage description." >&2
  exit 1
fi
codesign -d --entitlements - --xml "$app" >"$entitlements" 2>/dev/null
if [[ "$(/usr/libexec/PlistBuddy -c "Print :com.apple.security.device.audio-input" "$entitlements" 2>/dev/null)" != "true" ]]; then
  echo "The signed app is missing the audio-input entitlement." >&2
  exit 1
fi
echo "Microphone usage description and entitlement verified."

# ONNX Runtime and whisper.cpp are linked statically; the DMG must not need developer libraries.
executable=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$app/Contents/Info.plist")
while read -r library _; do
  case "$library" in
    /System/Library/* | /usr/lib/*) ;;
    *)
      echo "The app links a library outside the system: $library" >&2
      exit 1
      ;;
  esac
done < <(otool -L "$app/Contents/MacOS/$executable" | tail -n +2)
echo "Only system libraries are linked."
