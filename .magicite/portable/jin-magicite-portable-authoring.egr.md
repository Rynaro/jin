---
spec: engram/1.0
name: jin-magicite-portable-authoring
id: egr_181d50ae
version: 1
intent:
  does: Turn verified Jin lessons into portable native Magicite engrams while preserving custody-bound local
    trust.
  use_when: Adding or revising Jin portable Magicite procedures, checking admission, or documenting their local
    registration.
  not_when: Approving trust, changing Magicite policy, or authoring an unrelated host skill.
compatibility: {}
capabilities:
  requires: []
  produces:
  - kind: artifact
    id: artifact.jin-portable-engram
    version: 1.0.0
risk:
  filesystem: write-project
  subprocess:
    mode: declared-tools
    tools:
    - python3
  network:
    mode: none
    destinations: []
  secrets: none
routing:
  positive:
  - Jin Magicite portable engram
  - Jin skill catalog
  - Magicite procedure admission
  negative:
  - trust approval or policy change
  body_digest: 661fd178a7b2ddbcd84d0a94e4b4a01449d37f38c579a7007303241fe4e63bbb
origin:
  channel: authored
  verification_status: pending
  content_hashes:
    body_sha256: 661fd178a7b2ddbcd84d0a94e4b4a01449d37f38c579a7007303241fe4e63bbb
assets: {}
extensions: {}
---
## Procedure
1. Ground the lesson in current Jin source, tests, or reviewed operational documentation and give it a narrow intent with positive and negative routing phrases.
2. Author the portable source under `.magicite/portable/` in native `engram/1.0` format. Include only declared risks, runnable verification, concrete pitfalls, and provenance that the evidence supports.
3. Validate the exact file with the installed Magicite schema/parser and check its routing body digest. Keep the identity stable, regenerate a body digest after edits, and require new operator review for changed content.
4. Update `docs/magicite.md` when catalog or clone intake guidance changes. Preserve local `.magicite/engrams/`, approval records, enrollment markers, custody journal, and policy.
5. Register only the newly authored portable identity into the local registry when requested, then sync and report registered, pending-review, and verified status separately.

## Pitfalls
- A portable source does not grant local approval or authorize an agent to approve itself.
- Copying an active registry or custody markers between checkouts breaks local trust identity.

## Examples
+ Add a procedure grounded in a focused regression suite and report it as pending review.
- Activate a new trust policy → not this engram.

## Provenance
- Derived from `docs/magicite.md`, the local portable catalog, and Magicite custody guidance.
