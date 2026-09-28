---
eidolon: ramza
version: 0.1.0
kind: spec
status: ready-for-vivi
created_at: 2026-09-24T12:00:00Z
target_repos: [jin]
stories_count: 4
validation_gates_count: 10
---
# Notes links: external opening, seamless composition and calmer reading

## Scope

CHANGE/BUG_SPEC. RAMZA → Vivi, standard tier; Astra6High plans, Sol6High sole product writer. User authorizes implementation, including a narrow native external-opening boundary. Preserve the dirty branch, Notes data/Markdown, explorer/sidebar/native toolbar and OAuth flow. No automatic website metadata/favicon fetches, rich-text migration, custom-protocol opening, unrelated app redesign or broad CSP rewrite.

## Approach

Read renders ordinary anchors with no opening interception; the main native webview has no navigation policy. Edit only decorates labels, with no link-opening or paste-specific interaction. `open_external`/opener does not exist. Existing core OAuth explicitly launches a system browser separately. Fix the app-owned opening boundary and enforce it natively, then unify the link presentation and compact Notes typography.

Existing card serialization is a whole Markdown line `[Label](https://example.com/path "jin-card")`. Read marks standalone paragraph anchors; CM decorates inactive lines. Read currently requires label != href and shows full URL; Edit shows host. Keep this portable syntax and remove that accidental parity distinction. Plain URLs and ordinary inline Markdown remain valid.

## Stories

### S1 — One confirmed external-opening flow
As a writer, I want links to open in my browser while Jin remains exactly where I left it. Timebox: 2d. Risk: P0.
- Add a shared frontend URL policy and external-link service, initialized once. HTTP/HTTPS only for browser opening: parse an absolute URL, require a host, reject credentials/control characters and all other schemes. Validate again natively. Render the actual normalized destination with full hostname and inspectable path/query in the confirmation; do not substitute link label or truncate the host. Never log full URLs unnecessarily.
- Use an accessible shared-modal-based confirmation, “Open in browser?”, with Cancel initially focused and explicit Open in browser action. Escape/backdrop cancel; focus returns to originating link/editor. No remembered bypass. Only an affirmative action invokes opening; duplicate activation cannot create multiple dialogs or opens. Show busy/error in the dialog; failure leaves Retry/Cancel available and never navigates Jin.
- Capture actual anchors in sanitized Notes Read/history previews through a delegated listener at their common host; inspect `closest('a[href]')`. Prevent default for normal, modifier, keyboard Enter and middle-button/auxclick activation before awaiting anything. Browser context-menu Open/new-window paths must not become an unconfirmed escape: use controlled context handling on external Notes anchors and remove unmanaged target behavior. Preserve copying the address via a truthful explicit affordance. Block unsupported/relative links with clear feedback rather than letting them navigate internally; existing managed attachment placeholders retain their own behavior.
- Edit: keep ordinary label clicks/caret selection editable. Provide an explicit keyboard-accessible Open link affordance for an inactive rendered card/selected link and support Cmd/Ctrl-click on a recognized safe link, both through the same confirmation. No `window.location` or direct unmanaged `window.open` in editor paths. Resolve current document URL identity rather than stale position captured before edits.
- Native opener: a narrow `open_external_url(url)` command with strict parsed HTTP(S) validation. Use OS default-handler APIs/argument-based process launch, never shell command-string interpolation or Windows `cmd /c start`. Reuse current platform facilities; if a library is needed, keep one narrow audited opener dependency rather than an arbitrary shell capability. Surface launch errors through existing Jin error shape. Browser development fallback opens a separate noopener/noreferrer tab only after confirmation; never same-tab navigation, and report popup blocking. Stub this narrow API in deterministic QA, do not actually open remote destinations during browser tests.

### S2 — Native webview cannot leave the app
As a writer, I want a native backstop even if a content link bypasses its frontend handler. Timebox: 1d. Risk: P0.
- Add a pure, unit-tested main-webview navigation policy using exact configured production app origin and exact configured devUrl origin (including port, dev builds only). No blanket localhost, arbitrary `tauri:` host, `file:`, `data:`, `blob:`, HTTP or HTTPS allow. Same app document/hash navigation may remain valid. Asset subresource requests remain unaffected; allowing blob image rendering does not require allowing top-level blob navigation.
- Install policy for the existing main window before it loads. Locked local Tauri2.11.3 exposes builder `.on_navigation` and `.on_new_window`; use those hooks, or equivalent complete hooks supported by the locked API. If required, create main from its existing WindowConfig with auto-create disabled to attach both hooks. Preserve its titlebar, size, capabilities, drag/drop and startup behavior exactly; do not create duplicate windows.
- Reject external top-level navigation, redirects and new webview windows. Native interception must not silently open a browser; ordinary user clicks use S1 confirmation, bypass attempts remain blocked. Do not add Google/OAuth domains or loopback callback ports to the main-window allowlist: current OAuth already runs externally and completes through its existing backend loopback flow.
- Verify app startup, reload, frontend dev-server assets/HMR, local managed images, native titlebar and existing OAuth command remain functional. A browser fallback cannot prove native hooks; report native build/owner-check boundary accurately.

### S3 — Paste and link-card parity without fetching websites
As a writer, I want pasted URLs to become useful links with minimal interruption. Timebox: 2d. Risk: P1.
- A single safe URL pasted over selected non-code text inserts `[selected text](URL)` as one undoable CM transaction with proper Markdown escaping. Multi-selection, code/fenced contexts, multiline clipboard or non-URL text keep ordinary paste. Do not autoformat existing Markdown or rewrite documents on load.
- A single safe URL pasted into an empty paragraph automatically inserts the existing `"jin-card"` Markdown syntax, with the URL/host as honest default label. It previews when the cursor leaves that source line. Selected text gets inline Markdown as above; other contexts keep ordinary paste. Preserve inline/plain/card choices in the existing Insert link composer, without a new post-paste mode or compulsory modal. One undo reverses the whole paste. Keep selection mapping, IME and autosave intact; existing stored bare URLs are never rewritten on load.
- Use one presentational link model derived from authored label plus normalized URL/host. Both Edit and Read show the same compact banner: neutral surface/hairline, modest radius, link/document glyph, label and destination, optional explicit Open affordance. Remove the generic blue stripe. Do not claim a website title, project identity, thumbnail or favicon without provided metadata.
- A marked standalone card remains a card even when its label equals its URL. Inline decorated links are restrained underlined text with an unobtrusive external cue, not an extra card. Bare URLs wrap safely. Sanitize through the existing Markdown chokepoint; no raw-HTML or arbitrary-URL bypass.
- In CM, use a legal block decoration/state-field widget for real standalone card geometry, mirroring existing table/image discipline. Source becomes editable when selection enters/crosses it; never hide source inside code fences. Widget teardown releases handlers; click-to-edit and explicit Open are distinct. Shared geometry/text styling gives Edit/Read parity without mutating saved Markdown.

### S4 — Compact readable typography
As a writer, I want Notes to read with Apple Notes' calmer density. Timebox: 1d. Risk: P2.
- Set shared Notes prose baseline to15px equivalent (`.9375rem` against current16px root), system face, line-height1.5. Read paragraph margin becomes about.65em, list spacing correspondingly restrained; title stays about26px and headings retain clear hierarchy without large editorial gaps. Edit and Read use the same prose size/line-height and writing edges.
- Preserve Markdown blank lines and hard breaks in Edit; do not collapse source whitespace to fake Read rhythm. Adjust styles at tokens and existing Notes owners, not global body text. Keep code monospace, current table/image containment, explorer text and toolbar sizing separate.
- Use relative units and existing dynamic text multiplier; AX3.1 remains readable and unclipped. Contrast, links/focus and checked states remain legible in dark/high contrast. At320/390 long URLs/cards reflow without document overflow.

## Ownership and order

Sol: frontend `src/lib/notes/{editor,livePreview,markdown,render}.ts`, focused shared `src/lib/ui` external-link service/URL policy, `src/main.ts` initialization and `invoke.ts`; native `src-tauri/src/{lib.rs,commands/mod.rs}` plus focused opening/navigation module, `tauri.conf.json` only if manual main creation is required, native dependency/features only if justified; `tokens.css`, `browse.css`, narrow a11y owner; focused frontend/native tests and accepted dossier update. Root owns browser/native QA and build. Astra independent review.

Order S1 boundary → S2 native policy → S3 paste/card parity → S4 typography. Do not change jin-core OAuth opener as collateral work. Preserve accepted Notes and explorer behavior; do not weaken sanitizer or grant general shell access.

## Rejected Alternatives

`target=_blank` alone does not guarantee OS browser or confirmation. Opening links automatically in the navigation callback bypasses user approval. CSS-only card parity cannot provide safe CM source editing. Remote preview scraping leaks visits and invents metadata dependence. A blanket localhost/native-scheme allowlist is broader than the actual app origins.

## Risks

P0: shell/URL parsing mismatch and missing new-window handling. P1: modal lifetime/double-open, stale CM positions, unsafe fence decoration, programmatic window creation altering native chrome. Mitigate with pure policies, explicit tests, current-config construction and root owner verification. Mailto remains unsupported for browser opening and must provide clear feedback; do not silently invoke another application.

## Acceptance Criteria

### AC-01 (event-driven)
WHEN a Notes Read/history HTTP(S) link activates by click, Enter, modifier or middle click
THEN Jin shall prevent document navigation before showing its confirmation.
VERIFY: delegated activation tests plus root location/state assertions.
### AC-02 (event-driven)
WHEN confirmation is cancelled
THEN no external-opening invocation shall occur.
VERIFY: default focus, Escape/backdrop and explicit Cancel tests.
### AC-03 (event-driven)
WHEN the user confirms a valid destination
THEN only that validated destination shall be passed to the default-browser opener once.
VERIFY: exact URL and repeated-click tests; native opener boundary test.
### AC-04 (unwanted-behavior)
WHEN opening fails or a URL uses an unsupported scheme
THEN Jin shall show truthful feedback without leaving its document.
VERIFY: rejection/missing handler/scheme and browser popup-block tests.
### AC-05 (state-driven)
GIVEN native main-webview navigation or new-window requests
THEN only the explicitly allowed app navigation shall proceed.
VERIFY: native policy tests covering production/dev/port/credentials/redirect/unsafe schemes, plus build.
### AC-06 (event-driven)
WHEN a single URL is pasted over eligible selected text
THEN one undo shall restore the original source selection content.
VERIFY: CM paste transaction test with escaped labels and code/multiline exclusions.
### AC-07 (event-driven)
WHEN a standalone pasted URL becomes a card
THEN Edit and Read shall represent the same authored label and destination.
VERIFY: card=URL regression and both-mode screenshot.
### AC-08 (state-driven)
GIVEN a link card in fenced code or an active source selection
THEN the editor shall preserve accessible editable source.
VERIFY: CM decoration/selection mapping tests.
### AC-09 (state-driven)
GIVEN links or cards displayed without user confirmation
THEN no website metadata request shall occur.
VERIFY: network/invoke spy; only local rendering allowed.
### AC-10 (state-driven)
GIVEN Notes Read/Edit at320/390 or AX3.1
THEN typography and link cards shall remain readable without horizontal document overflow.
VERIFY: root compact/large-text light/dark matrix with paragraphs, lists and long URLs.

## Confidence

High on diagnosis and existing Markdown/UI owners. Native policy must be checked against the locked Tauri API and actual startup URL; no speculative origin allowlist. Root supplies independent review and native build boundary. User direction resolves typography and browser-opening behavior; implementation needs no further approval.

```yaml
handoff:
  from: ramza
  to: vivi
  implementer: Sol6High
  approval: authorized
  opener_schemes: [https, http]
  confirmation: every_open
  metadata_fetch: false
  order: [S1, S2, S3, S4]
  validation: [frontend_tests, native_policy_tests, build, root_visual_and_native_checks]
```
