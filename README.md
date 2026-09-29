<div align="center">

<img src="docs/assets/jin.png" alt="Jin logo" width="150">

# Jin

**Your notes, tasks, and calendar in one local workspace.**

[![CI](https://github.com/Rynaro/jin/actions/workflows/ci.yml/badge.svg)](https://github.com/Rynaro/jin/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Rynaro/jin?label=release)](https://github.com/Rynaro/jin/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

[Download](#download) · [Get started](#get-started) · [Features](#features) · [Build from source](#build-from-source) · [Contribute](CONTRIBUTING.md)

</div>

![Jin’s Today agenda with example events, connected work, and tasks](docs/assets/jin-today-preview.png)

<p align="center"><sub>Today view with example data. Your workspace starts with your own files.</sub></p>

Jin brings daily planning and the work behind it into one place. Write notes,
track tasks, and see calendar context without handing over your data: Markdown
and YAML are the source of truth, while SQLite is a rebuildable index. The
desktop app and command-line interface use the same Rust core.

## Features

- **A connected day.** See events, tasks, and related notes together in Today.
- **Notes that stay yours.** Write and organize Markdown notes in a local
  folder, with links to the work and events they support.
- **Tasks with structure.** Capture tasks, organize them in lists or boards,
  and schedule one as an event when it needs time on the calendar.
- **A desktop app and a CLI.** Work visually or script common actions against
  the same local workspace.
- **Calendar when you want it.** Connect Google Calendar with your own OAuth
  client, or keep your calendar data local. Desktop reminders run on your
  device while Jin is open.

## Download

The [latest release](https://github.com/Rynaro/jin/releases/latest) has
desktop installers and CLI archives. These are the published v1.0.0 assets:

| Platform | Desktop app | CLI |
| --- | --- | --- |
| macOS · Apple Silicon | [DMG](https://github.com/Rynaro/jin/releases/download/v1.0.0/Jin_1.0.0_aarch64.dmg) | [tar.gz](https://github.com/Rynaro/jin/releases/download/v1.0.0/jin-cli-1.0.0-macos-aarch64.tar.gz) |
| Linux · x86-64 | [DEB](https://github.com/Rynaro/jin/releases/download/v1.0.0/Jin_1.0.0_amd64.deb) · [AppImage](https://github.com/Rynaro/jin/releases/download/v1.0.0/Jin_1.0.0_amd64.AppImage) | [tar.gz](https://github.com/Rynaro/jin/releases/download/v1.0.0/jin-cli-1.0.0-linux-x86_64.tar.gz) |
| Windows · x86-64 | [Setup EXE](https://github.com/Rynaro/jin/releases/download/v1.0.0/Jin_1.0.0_x64-setup.exe) | [ZIP](https://github.com/Rynaro/jin/releases/download/v1.0.0/jin-cli-1.0.0-windows-x86_64.zip) |

On macOS, open the DMG and drag Jin to Applications. On Linux, install the DEB
or make the AppImage executable and run it. On Windows, run the setup EXE.
For the CLI, extract the archive and put `jin` (or `jin.exe`) on your `PATH`.
Check a download against the release’s [SHA256SUMS](https://github.com/Rynaro/jin/releases/download/v1.0.0/SHA256SUMS).

The macOS app is ad-hoc signed but not Apple notarized; the Windows installer
is unsigned. Your OS may ask you to confirm that you want to open it. Linux
packages are built on Ubuntu 24.04 x64 and require a graphical desktop with
WebKitGTK support.

## Get started

**Desktop:** Open Jin and follow the first-run guide to choose a folder for
your workspace. Capture a note or task, then open Today to see what is ahead.

**CLI:** Initialize a folder, add some work, and view your agenda:

```console
$ jin --root ~/jin-store init
$ jin --root ~/jin-store note add "Roadmap review notes"
$ jin --root ~/jin-store task add "Draft quarterly roadmap"
$ jin --root ~/jin-store today
```

Run `jin --help` to explore commands and `jin <command> --help` for options.
The CLI also supports JSON output for scripts.

## Your data and integrations

Your workspace’s Markdown and YAML files are canonical. Jin can rebuild its
SQLite index from them, and the CLI supports export and import. Optional Google
Calendar sync needs a Google Desktop OAuth client that you configure; see the
[setup guide](docs/google-smoke-test.md). Reminders are local to the desktop
app and do not sync between devices.

Jin is actively developed. Real-account OAuth validation, recurring-event
editing, multi-device sync, and mobile capture remain work in progress.
Automated GUI checks cover logic; native appearance and installer behavior
need platform testing.

## Build from source

Install stable Rust and, for the desktop app, Node.js 20+ and npm 10+. macOS
needs Xcode Command Line Tools; Linux needs the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Rynaro/jin.git
cd jin
cargo build --release --locked -p jin
./target/release/jin --root ~/jin-store init
```

For desktop development:

```bash
cd jin-gui
npm ci
npm run tauri -- dev
```

Run `make verify` for core and CLI checks, `make verify-gui` for GUI logic,
or `make verify-all` for both. The [release runbook](docs/releasing.md)
covers packaging.

## Documentation and help

| Topic | Where to go |
| --- | --- |
| First-run setup | [Getting started with the desktop app](docs/first-time-setup.md) |
| Calendar connection | [Google Calendar setup and smoke test](docs/google-smoke-test.md) |
| Architecture | [Architecture decisions](docs/adr/) |
| Testing | [Testing strategy](docs/testing.md) · [GUI testing](docs/gui-testing.md) |
| Questions or bugs | [GitHub Issues](https://github.com/Rynaro/jin/issues) |
| Security reports | [Security policy](SECURITY.md) |
| Contributions | [Contributing guide](CONTRIBUTING.md) |

Jin is licensed under the [GNU Affero General Public License v3.0](LICENSE).
