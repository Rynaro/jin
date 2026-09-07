.PHONY: build test check fmt clippy verify docker-build docker-test \
        build-gui test-gui verify-gui verify-macos-app verify-all

# ── Core (jin-core + jin CLI) ─────────────────────────────────────────────────

build:
	cargo build -p jin-core -p jin

test:
	cargo test -p jin-core -p jin

check:
	cargo check -p jin-core -p jin

fmt:
	cargo fmt --all

clippy:
	cargo clippy -p jin-core -p jin --all-targets -- -D warnings

# Standing verification gate (S9) — core packages only.
# The GUI is excluded from this path so the headless CI stays lean.
# Run `make verify-gui` separately to gate the GUI scaffold.
verify:
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
	cargo build -p jin-gui

test-gui:
	cargo test -p jin-gui

# Build and verify the locally signed macOS app. Tauri's ad-hoc signing pass
# binds the full bundle and uses CFBundleIdentifier as the CodeDirectory ID.
verify-macos-app:
	@test "$$(uname -s)" = "Darwin" || { echo "verify-macos-app requires macOS" >&2; exit 1; }
	cd jin-gui && npm run tauri -- build --debug --bundles app
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
		npx vite build && \
		echo "  vite build: ok" && \
		npm run test:production-due && \
		echo "  production due editor smoke: ok"
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
