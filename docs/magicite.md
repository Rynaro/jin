# Magicite for Jin contributors

[Magicite](https://github.com/Rynaro/magicite) is an optional local MCP skill
registry for assistants working on Jin. Jin's application and build do not
depend on it. The assistant host owns execution and its permissions.

## Portable project skills

The catalog contains 27 portable skills, including the original 13, one imported Playwright draft, and 13 new procedures.

The original thirteen `.magicite/portable/` artifacts use `engram/1.0`. They preserve
Jin's storage, CLI, core, GUI, accessibility, temporal, sync, account, calendar,
and onboarding procedures. Risk metadata declares project writes and only the
applicable `cargo`/`pnpm` tools, without network or secret access. Verification
guidance uses actual GUI scripts: `test`, `build`, and `lint:css`.

Thirteen additional portable procedures capture completed Jin work where the
failure boundary is specific enough to guide future changes. Their filenames and
routing contracts are grouped below. Every new source begins pending local review.

- **Storage and recovery** — [portable conflicts](../.magicite/portable/jin-portable-conflict-safety.egr.md), [restorable exports](../.magicite/portable/jin-restorable-backup-integrity.egr.md), and [build storage](../.magicite/portable/jin-build-storage-guard.egr.md).
- **Tasks and workspace** — [workflow projection](../.magicite/portable/jin-task-workflow-projection.egr.md), [task recurrence](../.magicite/portable/jin-persistent-task-recurrence.egr.md), [Today projection](../.magicite/portable/jin-today-projection-date-integrity.egr.md), and [Find](../.magicite/portable/jin-desktop-find-read-model.egr.md).
- **Editing and integrations** — [Capture Review](../.magicite/portable/jin-capture-review-conversion.egr.md), [note drafts](../.magicite/portable/jin-notes-editor-draft-integrity.egr.md), and [Google desktop sign-in](../.magicite/portable/jin-google-desktop-signin-setup.egr.md).
- **Operations and evidence** — [visual acceptance](../.magicite/portable/jin-native-visual-acceptance.egr.md), [release acceptance](../.magicite/portable/jin-release-acceptance-evidence.egr.md), and [portable authoring](../.magicite/portable/jin-magicite-portable-authoring.egr.md).

The imported `jin-playwright-mcp` skill preserves the repository’s Playwright
procedure. It declares npm, project writes for browser evidence, and the local
Vite origin. To use it, review its exact content and ensure the local retrieval
policy permits npm and the declared access. It ships as a draft.

The legacy `needs` dependencies remain intact. Ten cyclic `composes` references
were removed from six artifacts so the thirteen-skill graph has a valid order.
No procedure bodies changed as part of that composition repair.

`.magicite/magicite.toml` enables offline FastEmbed and permits `cargo` and
`pnpm` for retrieval eligibility. This ceiling does not execute commands or
override host permissions. Autonomous approval remains disabled. `AGENTS.md`
and the Claude project rule describe route → load → apply → report, including
abstention and exact decision/content/policy binding.

The Git artifacts contain no machine enrollment markers or admission records. The active
`.magicite/engrams/` registry is local and ignored because authenticated enrollment
markers are specific to this project custody identity.

On a fresh clone, keep the portable sources in `.magicite/portable/`, install the
project client, and call the Magicite MCP `register` tool with an absolute path to
that directory and `format: "egr"`. This imports the sources into the local active
registry at `.magicite/engrams/`. Call the MCP `sync` tool, then review each imported
artifact and approve its current digest with the actual operator identity. For
example, the registration arguments are

```json
{"path":"/absolute/path/to/jin/.magicite/portable","format":"egr"}
```

Do not copy another checkout's active artifacts, approval records, or custody
journal. Existing checkouts retain their custody-bound active registry. The
published 1.0.0 intake path rejects an unmarked portable artifact when its ID
already has a decision, so registering a changed source directly is not an update
path. Preserve this checkout's exact reviewed copies at `.magicite/engrams/` and
restore them there after accepting the portable-source rename, then run `sync`.
Keep any temporary copy outside the tracked tree. `sync` indexes the active
registry; it does not import changes from `.magicite/portable/` by itself. Only
procedures with an existing approval are eligible. `jin-playwright-mcp` remains a
draft until it receives its own review and approval.
A clone must enroll, register, and review its own exact content before use;
committing a skill never grants trust.

In an already enrolled checkout, register only the new source you intend to
admit by passing its absolute `.magicite/portable/*.egr.md` path to `register`,
then run `sync` and review that source's current digest. Do not re-register the
entire directory when adding one procedure.

## Install and configure the harnesses

The complete installer is being delivered in
[Magicite PR #87](https://github.com/Rynaro/magicite/pull/87). Until that change is
released, use its reviewed source checkout; the published `magicite==1.0.0`
package does not provide this complete installer workflow. From that checkout:

```sh
python3 scripts/install_magicite.py --package . --project-root /absolute/path/to/jin
```

Use the canonical checkout path. The installer prepares a project client,
model cache and a separate protected runtime, asks for the baseline policy
approval, and uses normal administrator authentication to provision an
independent custody service on macOS/launchd or Linux/systemd. Existing policy
and history remain authoritative. Inspect the policy prompt: the baseline has
no trusted publisher roots. Do not automatically accept or replace an existing
policy. See the [operator tutorial](https://github.com/Rynaro/magicite/blob/codex/complete-harness-installer/docs/operator-tutorial.md)
for prerequisites, recovery and existing-registry handling.

Setup configures Claude Code, Codex, and OpenCode and installs their routing
instructions after runtime checks pass. It supports OpenCode v1 and v2 schemas.
If a foreign Magicite entry already exists, back it up and deliberately migrate
only that entry; preserve other servers. Native project trust/MCP acceptance
prompts still apply. Accept only the intended Magicite server. Restart existing
host sessions after changing configuration.

The project client executable is `.magicite/venv/bin/magicite`. From Jin:

```sh
.magicite/venv/bin/magicite harness status --project-root .
.magicite/venv/bin/magicite harness disable --project-root . --harness claude
.magicite/venv/bin/magicite harness enable --project-root . --harness claude
```

Selectors are `claude`, `codex`, `opencode`, or `all`. Disable is durable across
setup runs; explicit enable clears that opt-out. Host templates in
`.magicite/host-templates/` are optional manual examples; replace every absolute
path placeholder and merge only Magicite into existing configuration. Local
`.mcp.json`, `.codex/config.toml`, and `opencode.json` are ignored.

## Review and verify

Enrollment and sync do not approve a skill. Review the full current artifact
and use the digest returned by the installed client:

```sh
.magicite/venv/bin/magicite trust review --project-root . --engram-id REPLACE_WITH_ID
.magicite/venv/bin/magicite trust approve --project-root . \
  --engram-id REPLACE_WITH_ID --expected-digest REPLACE_WITH_REVIEWED_DIGEST \
  --actor YOUR_ACTUAL_REVIEWER_IDENTITY --reason 'Describe the actual review'
```

Do not invent human review, approve obsolete digests, or copy another machine's
admissions. Each content change requires review of its current exact version.

Ask the host to list tools and route a real Jin task with actual context. For a
selected candidate, call `load_skill_body` with its name, decision ID, selected
content digest, policy digest and required context. Verify the returned body.
Honor abstention and stale/missing context rather than bypassing eligibility.

Portable artifacts were separately checked for schema admission, body parity,
and an acyclic composition graph. The deployed variants include local enrollment
markers, so their approved whole-file digests differ from these portable copies.

During this rollout, the local macOS installation was exercised with protected
custody, real offline ONNX inference, all thirteen exact-content admissions,
Claude/OpenCode connections and Codex registration. A stable-ID/link query
selected a valid four-node plan and loaded the linked-domain procedure; a
calendar query selected and loaded its one-node procedure. These are local
integration checks, not retrieval-quality qualification, cross-platform
production certification, or live Google-provider tests. Local authority,
SQLite state, approvals, runtimes, backups, and private logs are excluded from
Git; these results do not automatically make another clone trusted.
