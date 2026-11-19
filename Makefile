.DEFAULT_GOAL := build

.PHONY: build test check fmt clippy verify docker-build docker-test \
        build-gui test-gui verify-gui verify-macos-app verify-all \
        verify-core-commands verify-gui-commands storage-inspect storage-clean-preview

# Python 3.9+ is used by the portable storage guard. Tune these values using
# .artifacts/storage reports. See docs/development-storage.md for debugger mode.
PYTHON ?= python3
STORAGE_RESERVE_GIB ?= 5
STORAGE_BUDGET_GIB ?= 5
VERIFY_MAKE = $(MAKE)
STORAGE_RUN = $(PYTHON) scripts/dev_storage.py run --reserve-gib $(STORAGE_RESERVE_GIB) --budget-gib $(STORAGE_BUDGET_GIB)

storage-inspect:
	$(PYTHON) scripts/dev_storage.py inspect

storage-clean-preview:
	$(PYTHON) scripts/dev_storage.py cleanup cargo

# ── Core (jin-core + jin CLI) ─────────────────────────────────────────────────

build:
	$(STORAGE_RUN) --report .artifacts/storage/build.json -- cargo build -p jin-core -p jin

test:
	$(STORAGE_RUN) --report .artifacts/storage/test.json -- cargo test -p jin-core -p jin

check:
	$(STORAGE_RUN) --report .artifacts/storage/check.json -- cargo check -p jin-core -p jin

fmt:
	cargo fmt --all

clippy:
	$(STORAGE_RUN) --report .artifacts/storage/clippy.json -- cargo clippy -p jin-core -p jin --all-targets -- -D warnings

# Standing verification gate (S9) — core packages only.
# The GUI is excluded from this path so the headless CI stays lean.
# Run `make verify-gui` separately to gate the GUI scaffold.
verify:
	$(STORAGE_RUN) --report .artifacts/storage/verify.json -- $(VERIFY_MAKE) verify-core-commands

verify-core-commands:
	cargo fmt --check
	cargo clippy -p jin-core -p jin --all-targets -- -D warnings
	# SQLite-backed integration tests require serialization for deterministic, non-hanging gates.
	RUST_TEST_THREADS=1 cargo test -p jin-core -p jin
	@echo "--- determinism loop (5 passes) ---"
	@for n in 1 2 3 4 5; do \
		printf "  pass %d/5 ... " "$$n"; \
		RUST_TEST_THREADS=1 cargo test -p jin-core -p jin --quiet 2>&1 || { echo "FAIL"; echo "DETERMINISM FAIL: pass $$n had test failures" >&2; exit 1; }; \
		echo "ok"; \
	done
	@echo "--- determinism loop: 5/5 passes clean ---"

# ── GUI (jin-gui Tauri scaffold) ──────────────────────────────────────────────

build-gui:
	$(STORAGE_RUN) --report .artifacts/storage/build-gui.json -- cargo build -p jin-gui

test-gui:
	$(STORAGE_RUN) --report .artifacts/storage/test-gui.json -- cargo test -p jin-gui

# Build and verify the locally signed macOS app. Tauri's ad-hoc signing pass
# binds the full bundle and uses CFBundleIdentifier as the CodeDirectory ID.
verify-macos-app:
	@test "$$(uname -s)" = "Darwin" || { echo "verify-macos-app requires macOS" >&2; exit 1; }
	$(STORAGE_RUN) --full-debug --cwd jin-gui --report .artifacts/storage/macos-app.json -- npm run tauri -- build --debug --bundles app
	./jin-gui/tools/verify-macos-app-signing.sh target/debug/bundle/macos/Jin.app

# GUI verification gate (GUI-S6): Rust fmt+clippy+bridge tests, then the full
# frontend gate — tsc type-check + vitest logic units + stylelint VG-GUI-5 +
# vite production build.  One command to gate any GUI change.
#
# [VG-GUI-8] Result labelling: LOGIC VERIFIED — visuals NOT verified.
# Visual correctness requires the owner's sign-off checklist:
#   docs/gui-testing.md §5
#
# Run this after making changes to jin-gui/.
verify-gui:
	$(STORAGE_RUN) --report .artifacts/storage/verify-gui.json -- $(VERIFY_MAKE) verify-gui-commands

verify-gui-commands:
	cargo fmt --check
	cargo clippy -p jin-gui --all-targets -- -D warnings
	cargo test -p jin-gui
	@echo "--- bridge tests passed (VG-GUI-1 VG-GUI-2 VG-GUI-3 VG-GUI-4) ---"
	@cd jin-gui && \
		export NVM_DIR="$$HOME/.nvm"; \
		. "$$NVM_DIR/nvm.sh"; \
		nvm use --lts >/dev/null 2>&1; \
		hash -r 2>/dev/null; \
		npm ci --silent && \
		npx tsc --noEmit && \
		echo "  tsc --noEmit: ok" && \
		npm test && \
		echo "  vitest frontend logic units: ok" && \
		npm run lint:css && \
		echo "  stylelint VG-GUI-5 token discipline: ok" && \
		npm run build && \
		echo "  vite build: ok" && \
		npm run test:production-due && \
		echo "  production due editor smoke: ok" && \
		npm run test:notes-writing-surface && \
		echo "  notes writing surface smoke: ok" && \
		npm run visual:selftest && \
		echo "  visual reference detector selftest: ok"
	@echo "--- all GUI gates green ---"
	@echo ""
	@echo "[VG-GUI-8] LOGIC VERIFIED — visuals NOT verified."
	@echo "           Owner visual sign-off required: docs/gui-testing.md section 5."

# Run the core gate and the GUI gate in sequence.
verify-all: verify verify-gui

# ── Docker ────────────────────────────────────────────────────────────────────

docker-build:
	docker build --target builder -t jin:build .

docker-test:
	docker build --target tester -t jin:test .
