# Jin — build + test image
# Base: rust:1.96 bundles gcc, git, pkg-config
FROM rust:1.99 AS builder

WORKDIR /app

# The workspace manifest includes the GUI member and a local glib patch, so
# build from the complete context using the audited lockfile.
COPY . .

# Full build
RUN cargo build --release --locked

# Test stage (separate target to allow `make docker-test`)
FROM builder AS tester
RUN cargo test --workspace --locked
