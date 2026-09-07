# Jin — build + test image
# Base: rust:1.96 bundles gcc, git, pkg-config
FROM rust:1.96 AS builder

WORKDIR /app

# Cache dependencies layer
COPY Cargo.toml Cargo.lock* ./
COPY jin-core/Cargo.toml ./jin-core/
COPY jin/Cargo.toml ./jin/

# Stub source so cargo can resolve the dependency graph
RUN mkdir -p jin-core/src && echo "pub fn placeholder() {}" > jin-core/src/lib.rs
RUN mkdir -p jin/src && echo "fn main() {}" > jin/src/main.rs
RUN cargo fetch

# Full build
COPY . .
RUN cargo build --release

# Test stage (separate target to allow `make docker-test`)
FROM builder AS tester
RUN cargo test --workspace
