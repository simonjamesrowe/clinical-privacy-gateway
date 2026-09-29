#!/bin/bash
# Build repeatable local test packages with a stable macOS signing identity.
# Ad-hoc signatures identify one exact build, so Keychain asks again whenever
# the binary changes. This local-only identity gives successive test builds the
# same designated requirement without placing signing material in the repo.
set -euo pipefail

identity_name="Clinicians Veil Local Development"
signing_dir="${CLINICIANS_VEIL_SIGNING_DIR:-$HOME/Library/Application Support/Clinicians Veil Development/signing}"
keychain_path="$signing_dir/clinicians-veil-local.keychain-db"
password_path="$signing_dir/keychain-password"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Local DMG signing is available only on macOS." >&2
  exit 1
fi

mkdir -p "$signing_dir"
chmod 700 "$signing_dir"

if [[ ! -f "$keychain_path" ]]; then
  temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/clinicians-veil-signing.XXXXXX")
  cleanup_setup() {
    find "$temporary_dir" -type f -delete
    rmdir "$temporary_dir"
  }
  trap cleanup_setup EXIT

  openssl rand -base64 32 > "$password_path"
  openssl rand -base64 32 > "$temporary_dir/p12-password"
  chmod 600 "$password_path" "$temporary_dir/p12-password"
  cat > "$temporary_dir/openssl.cnf" <<'EOF'
[req]
distinguished_name = subject
x509_extensions = code_signing
prompt = no

[subject]
CN = Clinicians Veil Local Development
O = Clinicians Veil Local Development

[code_signing]
basicConstraints = critical,CA:true
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF
  openssl req -new -newkey rsa:3072 -x509 -sha256 -days 3650 -nodes \
    -config "$temporary_dir/openssl.cnf" \
    -keyout "$temporary_dir/signing.key" \
    -out "$temporary_dir/signing.crt"
  # macOS Keychain cannot import OpenSSL 3's newer PKCS#12 defaults.
  openssl pkcs12 -export -legacy \
    -inkey "$temporary_dir/signing.key" \
    -in "$temporary_dir/signing.crt" \
    -name "$identity_name" \
    -passout "file:$temporary_dir/p12-password" \
    -out "$temporary_dir/signing.p12"

  security create-keychain -p "$(cat "$password_path")" "$keychain_path"
  security unlock-keychain -p "$(cat "$password_path")" "$keychain_path"
  security set-keychain-settings -lut 21600 "$keychain_path"
  security import "$temporary_dir/signing.p12" \
    -k "$keychain_path" \
    -P "$(cat "$temporary_dir/p12-password")" \
    -T /usr/bin/codesign
  security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$(cat "$password_path")" \
    "$keychain_path" >/dev/null
  # Limit the local certificate's trust to code signing.
  security add-trusted-cert \
    -r trustRoot \
    -p codeSign \
    -k "$keychain_path" \
    "$temporary_dir/signing.crt"

  cleanup_setup
  trap - EXIT
fi

security unlock-keychain -p "$(cat "$password_path")" "$keychain_path"
if ! security find-identity -v -p codesigning "$keychain_path" | grep -Fq "\"$identity_name\""; then
  echo "The local Clinician's Veil signing identity is unavailable." >&2
  exit 1
fi

login_keychain="$HOME/Library/Keychains/login.keychain-db"

# `security list-keychains` prints every path indented and double-quoted.
# Strip both before reuse: a leftover quote or space makes `security` treat the
# entry as relative to ~/Library/Keychains and silently replaces the login
# keychain with a path that does not exist. Every app that reads the login
# keychain then fails until the search list is repaired by hand.
parse_keychain_path() {
  local line=$1
  line=${line#"${line%%[![:space:]]*}"}
  line=${line%"${line##*[![:space:]]}"}
  line=${line#\"}
  line=${line%\"}
  printf '%s' "$line"
}

original_keychains=()
while IFS= read -r line; do
  keychain=$(parse_keychain_path "$line")
  [[ -z "$keychain" ]] && continue
  if [[ "$keychain" != /* || ! -f "$keychain" ]]; then
    echo "Refusing to rewrite the keychain search list: unexpected entry '$keychain'." >&2
    exit 1
  fi
  original_keychains+=("$keychain")
done < <(security list-keychains -d user)

if [[ ${#original_keychains[@]} -eq 0 ]]; then
  echo "Refusing to rewrite the keychain search list: no user keychains found." >&2
  exit 1
fi

restore_keychain_search_list() {
  local status=$?
  trap - EXIT
  security list-keychains -d user -s "${original_keychains[@]}" || status=1
  # The login keychain must survive whatever happened above.
  if ! security list-keychains -d user | grep -Fq "$login_keychain"; then
    echo "Login keychain missing from search list after restore; resetting to the default." >&2
    security list-keychains -d user -s "$login_keychain" || status=1
  fi
  exit "$status"
}
trap restore_keychain_search_list EXIT

security list-keychains -d user -s "${original_keychains[@]}" "$keychain_path"

root_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$root_dir"
./node_modules/.bin/tauri build \
  --config '{"bundle":{"macOS":{"signingIdentity":"Clinicians Veil Local Development"}}}' \
  "$@"
