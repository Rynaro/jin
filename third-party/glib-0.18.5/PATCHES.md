# Local security patch

This directory is the verbatim `glib` 0.18.5 crate from crates.io, whose
archive SHA-256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.

It contains exactly one source change. `src/variant_iter.rs` applies upstream
gtk-rs-core commit
[`b5a4071e439bef2b5eea76c3aa25e5ae84839e34`](https://github.com/gtk-rs/gtk-rs-core/commit/b5a4071e439bef2b5eea76c3aa25e5ae84839e34),
which passes the output pointer to `g_variant_get_child` as mutable. This fixes
the undefined behavior described by RUSTSEC-2024-0429 and
GHSA-wrw7-89jp-8q8g.

Tauri's Linux GTK3 dependency chain currently requires `glib` 0.18.x. Remove
this `[patch.crates-io]` override when that chain resolves a published upstream
`glib` version at or above 0.20.0, then run the GUI Linux verification gate.
