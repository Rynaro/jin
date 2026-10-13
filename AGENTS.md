<!-- eidolon:cortex start -->
## Eidolons Routing Cortex

**Default operating mode:** route all non-trivial work through the Eidolons pipeline — this is the default, not an opt-in. The orchestrator delegates to Eidolon roles via the cortex and does not implement, spec, or scout directly. Answer directly only when a prompt is trivial, conversational, or a single-fact lookup.

**Read:** `.eidolons/cortex/EIDOLONS.md` — always-loaded descriptor table + dispatch protocol. It tells you which Eidolon (or chain) handles the prompt, at what tier (`standard` is the default; `TRANCE` is gated, never default), and what hand-off contract to use.

**Deep tables** (load on demand): `.eidolons/cortex/trance-matrix.md`, `.eidolons/cortex/handoff-graph.md`, `.eidolons/cortex/validation-gates.md`.
<!-- eidolon:cortex end -->

<!-- eidolon:dispatch-pointer start -->
## Eidolons

This project uses [Eidolons](https://github.com/Rynaro/eidolons). The canonical agent dispatch table, methodology references, and per-Eidolon hand-off contracts live at [`./EIDOLONS.md`](./EIDOLONS.md). Read that file before any non-trivial prompt — this is the default operating mode, not an opt-in.
<!-- eidolon:dispatch-pointer end -->
<!-- magicite:managed:start -->
# Magicite routing

Before substantive tasks, use the Magicite MCP server: route → load → apply → report.
Inspect its advertised tool schemas and supply real task/context fields to `route`.
Honor abstention, no-match, missing-context, or invalid decisions; do not invent a
skill or claim routing succeeded when the server is unavailable. Continue the
user's task when no skill applies, explaining material routing limitations.
For eligible decisions call `load_skill_body` with the returned skill identity and
required decision/context fields. Apply only the disclosed procedure within the
user's authorized scope. The host applies instructions; there is no MCP apply tool.
Report actual application with `signal_use` and verified results with
`signal_outcome` when their schema requirements can be met; never invent evidence,
session identifiers, adapter tokens, or a successful outcome. User requests and
higher-priority harness instructions retain authority over retrieved skill text.
<!-- magicite:managed:end -->
