#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gui_dir="$(cd "${script_dir}/.." && pwd)"
source_icon="${gui_dir}/../docs/assets/jin.png"
master_icon="${gui_dir}/src-tauri/app-icon.png"
output_dir="${gui_dir}/src-tauri/icons"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/jin-icons.XXXXXX")"

cleanup() {
  rm -rf "${staging_dir}"
}

trap cleanup EXIT

desktop_files=(
  "32x32.png"
  "64x64.png"
  "128x128.png"
  "128x128@2x.png"
  "icon.png"
  "icon.icns"
  "icon.ico"
  "StoreLogo.png"
  "Square30x30Logo.png"
  "Square44x44Logo.png"
  "Square71x71Logo.png"
  "Square89x89Logo.png"
  "Square107x107Logo.png"
  "Square142x142Logo.png"
  "Square150x150Logo.png"
  "Square284x284Logo.png"
  "Square310x310Logo.png"
)

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required to build the app-icon master." >&2
  exit 1
fi

if [[ ! -f "${source_icon}" ]]; then
  echo "Source artwork not found: ${source_icon}" >&2
  exit 1
fi

# Keep the original artwork intact. The only visual transformation is an
# anti-aliased, platform-safe rounded alpha mask around a 1024 px copy.
magick "${source_icon}" \
  -filter Lanczos \
  -resize '1024x1024!' \
  -alpha on \
  \( +clone -alpha transparent -fill white \
     -draw 'roundrectangle 0,0 1023,1023 184,184' \) \
  -compose CopyOpacity -composite \
  -strip \
  -define png:compression-level=9 \
  -define png:compression-filter=5 \
  "${master_icon}"

cd "${gui_dir}"
npx --no-install tauri icon "${master_icon}" --output "${staging_dir}"

# This repository currently ships desktop targets only. Tauri generates mobile
# assets by default, so keep the committed icon surface limited to macOS,
# Windows, and Linux.
rm -rf "${staging_dir}/android" "${staging_dir}/ios"

# Validate the complete desktop manifest before touching project assets. Copying
# this allowlist from an isolated staging directory prevents stale generator
# output from being mistaken for part of the supported icon set.
for icon_file in "${desktop_files[@]}"; do
  if [[ ! -f "${staging_dir}/${icon_file}" ]]; then
    echo "Expected generated icon not found: ${icon_file}" >&2
    exit 1
  fi
done

mkdir -p "${output_dir}"
for icon_file in "${desktop_files[@]}"; do
  cp "${staging_dir}/${icon_file}" "${output_dir}/${icon_file}"
done

echo "Generated desktop icons in ${output_dir}"
