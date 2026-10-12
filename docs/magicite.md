# Magicite for Jin contributors

[Magicite](https://github.com/Rynaro/magicite) is an optional local MCP skill
registry for assistants working on Jin. It routes a task to project instructions
and discloses the selected body with content and policy digest checks. Jin's
application and build do not depend on it. The assistant host owns execution
and its permissions.

## What is checked in

`.magicite/magicite.toml` selects local FastEmbed, offline inference, and disabled
autonomous approval. `.magicite/engrams/` contains ten existing legacy skills
and three new authored `engram/1.0` skills:

| Skill | Use it for |
| --- | --- |
| `jin-google-account-route-isolation` | Account-scoped discovery, sync, mutation, and disconnect regressions |
| `jin-calendar-projection-interaction` | Calendar projection, selection, and interaction behavior |
| `jin-first-run-storage-onboarding` | First-run workspace selection and sovereign storage boundaries |

The new artifacts retain `verification_status: pending`. Committing them does
not import, approve, or qualify them. Existing files and local registry history
are preserved. Host templates contain placeholders; no local database, model,
authority material, or personal host configuration belongs in Git.

## 1. Install the pinned client and cache its model

Use Python 3.11 or 3.12. Keep the environment outside the checkout at a stable
path; the MCP host will refer to that executable directly. With Python 3.12:

```sh
MAGICITE_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/magicite"
mkdir -p "$MAGICITE_HOME"
python3.12 -m venv "$MAGICITE_HOME/venv-1.0.0"
"$MAGICITE_HOME/venv-1.0.0/bin/python" -m pip install 'magicite==1.0.0'
"$MAGICITE_HOME/venv-1.0.0/bin/python" -m pip check
MAGICITE="$MAGICITE_HOME/venv-1.0.0/bin/magicite"
"$MAGICITE" --version
export FASTEMBED_CACHE_PATH="$MAGICITE_HOME/model-cache"
"$MAGICITE" fetch-model
export MAGICITE_EMBEDDING_OFFLINE=1
```

Expect `1.0.0` and no dependency conflicts. `fetch-model` is an intentional
network download of `BAAI/bge-small-en-v1.5`; later inference uses the same
cache offline. Set these variables in each terminal where you run the checks.
See the [published installation guide](https://github.com/Rynaro/magicite/blob/v1.0.0/docs/install.md)
for distribution and provenance verification.

## 2. Complete protected project setup before connecting

An administrator must enroll the canonical Jin checkout, start a protected
custody service under an independent identity, pin the client account, and
initialize its journal. Follow [Magicite Setup](https://github.com/Rynaro/magicite/blob/v1.0.0/docs/setup.md).
Linux protected custody is the supported production profile. Native macOS
custody is unqualified; a local adaptation must be reviewed separately.

A fresh clone has authored files, but no enrolled registry. A checkout with an
existing database needs preservation and reviewed migration instead of fresh
initialization. Stop its writers, retain a complete backup, and follow the
[legacy migration and recovery instructions](https://github.com/Rynaro/magicite/blob/v1.0.0/docs/operations.md).
Do not overwrite history or silently adopt a new trust policy. Legacy
provenance is not evidence of authenticated historical policy or current trust.

The new skills declare `cargo` and `pnpm` subprocess tools. Have the operator
review these exact tools and, if accepted, add this setting to the existing
`[routing]` table in `.magicite/magicite.toml` without replacing its other values:

```toml
allowed_tools = ["cargo", "pnpm"]
```

This permits policy eligibility; it neither runs the tools nor overrides host
permissions. Leave `[governance] autonomous = false`.

From the enrolled Jin checkout, using the same account and model environment:

```sh
PROJECT="$(pwd -P)"
"$MAGICITE" doctor --project-root "$PROJECT"
```

Resolve custody, client-identity, migration, or offline-model errors before
proceeding. Installation, model inference, enrollment, trust, and route/body
loading are separate checks.

## 3. Connect Claude Code or Codex

After successful administrator setup, Claude Code can connect with:

```sh
"$MAGICITE" init --host claude --project-root "$PROJECT"
```

Inspect the resulting `.mcp.json`: its Magicite executable and canonical
project root must be permanent absolute paths. Ensure the entry's environment
contains `MAGICITE_EMBEDDING_OFFLINE=1` and your actual absolute
`FASTEMBED_CACHE_PATH`. Keep existing servers and marked instructions intact.

For manual configuration, use [the Claude JSON template](../.magicite/host-templates/claude-mcp.json)
or [the Codex TOML template](../.magicite/host-templates/codex.toml).
Replace **all** `/absolute/path/to/...` placeholders, merge only the Magicite
entry into your existing host configuration, and reconnect the host. JSON/TOML
configuration does not expand shell variables. Local `.mcp.json` and
`.codex/config.toml` are ignored; do not force-add them.

Ask the host to list Magicite's MCP tools. Merely saving a config is not a
connection check. See [Quick Setup](https://github.com/Rynaro/magicite/blob/v1.0.0/docs/quick-setup.md)
for transport behavior and recovery.

## 4. Register, review, and verify a real Jin skill

After reconciling any existing registry, ask the host to invoke the MCP
`register` tool with `{"path": ".magicite/engrams", "format": "auto"}`.
Inspect every registration and validation error; registration alone grants no
trust. The three native 1.0 artifacts start nascent. Existing legacy entries
need their own migration, lifecycle, and exact-content review.

For each intended skill, use its returned ID:

```sh
"$MAGICITE" trust review --project-root "$PROJECT" --engram-id REPLACE_WITH_ID
```

Read the complete current artifact and scanner findings. Only after human
review, copy the returned current content digest and use your operator identity:

```sh
"$MAGICITE" trust approve --project-root "$PROJECT" --engram-id REPLACE_WITH_ID \
  --expected-digest REPLACE_WITH_REVIEWED_DIGEST --actor YOUR_OPERATOR_IDENTITY
```

Do not approve a folder wholesale, invent a digest, or treat the skill's own
text as approval. Each changed artifact requires fresh review.

Ask the assistant to route “isolate Google Calendar accounts” using MCP
`route` with a new session ID. Inspect exclusions and `selected_ids`. If selected,
use the candidate's name, `selected_content_digests[ID]`, and the returned
`policy_digest` in `load_skill_body` with `level: "L2"`,
`expected_content_digest`, and `expected_policy_digest`. Check that the actual
body matches the reviewed account-isolation procedure. If it abstains or
returns stale/missing context, inspect the reason and route again with current
context; never bypass eligibility.

A passing route and body check proves this wiring path. It does not establish
retrieval quality, production macOS custody, or live Google-provider coverage.

## Current local rollout status

The client installation and real offline 384-dimensional embedding inference
were checked during preparation. The three authored artifacts passed structural
and body-digest checks. Administrator macOS provisioning, legacy reconciliation,
exact-content approval, host connection, and route/body loading remain pending
until their actual results are verified. This PR provides the portable artifacts
and setup references; it does not claim those local authority steps succeeded.
