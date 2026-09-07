# Calendar PR 47 rescue

Implement RAMZA stories S0–S6 with the safety invariants first: atomic in-place
event mutation, Rust-owned authorization, half-open calendar projection,
canonical event-detail routing, visible failures, accessible controls, and a
usable persistent Month/Week/Day calendar surface.

CRYSTALIUM pre-flight was attempted by Vivi but the MCP transport closed before
returning records. Tonberry's recorded enforcement is `block`; verification is
therefore required in blocking mode with VIGIL as the identity-distinct checker.
