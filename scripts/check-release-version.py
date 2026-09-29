#!/usr/bin/env python3
"""Fail if first-party package, bundle and lockfile versions diverge."""

import argparse
import json
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", help="Release tag, for example v1.0.0")
    parser.add_argument("--version-only", action="store_true", help="Print only the validated version")
    args = parser.parse_args()

    cargo = {
        name: tomllib.loads((ROOT / path).read_text())["package"]["version"]
        for name, path in {
            "jin": "jin/Cargo.toml",
            "jin-core": "jin-core/Cargo.toml",
            "jin-gui": "jin-gui/src-tauri/Cargo.toml",
        }.items()
    }
    lock = tomllib.loads((ROOT / "Cargo.lock").read_text())
    versions = {**cargo}
    versions.update(
        {f"Cargo.lock:{name}": next(p["version"] for p in lock["package"] if p["name"] == name)
         for name in cargo}
    )
    package = json.loads((ROOT / "jin-gui/package.json").read_text())
    npm_lock = json.loads((ROOT / "jin-gui/package-lock.json").read_text())
    tauri = json.loads((ROOT / "jin-gui/src-tauri/tauri.conf.json").read_text())
    versions.update({
        "package.json": package["version"],
        "package-lock.json": npm_lock["version"],
        "package-lock.json:root": npm_lock["packages"][""]["version"],
        "tauri.conf.json": tauri["version"],
    })
    expected = cargo["jin"]
    if args.tag and args.tag != f"v{expected}":
        raise SystemExit(f"tag {args.tag!r} does not match v{expected}")
    mismatch = {name: value for name, value in versions.items() if value != expected}
    if mismatch:
        raise SystemExit(f"version mismatch (expected {expected}): {mismatch}")
    print(expected if args.version_only else f"First-party versions agree: {expected}")


if __name__ == "__main__":
    main()
