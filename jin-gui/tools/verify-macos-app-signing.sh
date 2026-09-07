#!/bin/sh
set -eu

app_path="${1:-target/debug/bundle/macos/Jin.app}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS app signing verification requires macOS" >&2
  exit 1
fi

if [ ! -d "$app_path" ]; then
  echo "macOS app bundle not found: $app_path" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$app_path"

bundle_identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")
code_identifier=$(codesign -dvv "$app_path" 2>&1 | sed -n 's/^Identifier=//p')
entitlements_file=$(mktemp)
trap 'rm -f "$entitlements_file"' EXIT HUP INT TERM
codesign -d --entitlements - "$app_path" >"$entitlements_file" 2>/dev/null

if [ -z "$bundle_identifier" ] || [ -z "$code_identifier" ]; then
  echo "could not read both bundle and CodeDirectory identifiers" >&2
  exit 1
fi

if [ "$code_identifier" != "$bundle_identifier" ]; then
  echo "CodeDirectory identifier mismatch: '$code_identifier' != '$bundle_identifier'" >&2
  exit 1
fi

if [ -s "$entitlements_file" ]; then
  echo "local macOS app signature unexpectedly contains entitlements" >&2
  exit 1
fi

echo "macOS app signing verified: identifier=$code_identifier"
