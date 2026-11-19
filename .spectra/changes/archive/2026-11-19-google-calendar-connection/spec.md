# Google Calendar connection onboarding

## Intent

Make the first Google Calendar connection understandable and recoverable from
Jin Settings while retaining the existing account-isolated OAuth and sync
boundaries. A user with configured credentials reaches the existing PKCE browser
flow from one primary action. A source build without credentials receives an
in-app path to import a Google Desktop OAuth client JSON file, then resumes the
same flow.

## Decisions

- [DECISION] Keep environment credentials and the per-vault `[google]` config as
  the credential sources already supported by Jin. Do not embed distributor
  credentials in the repository or binary.
- [DECISION] Make `Connect Google Calendar` the primary Settings action. An
  account alias is optional at connection time and remains editable afterward.
- [DECISION] When credentials are unavailable, let the native file picker select
  a Google installed-app JSON file. Parse and validate it in Rust, persist only
  valid credentials to the existing per-vault config, and never send the secret
  through frontend state or DTOs.
- [DECISION] Reuse the existing PKCE, token storage, subject binding, calendar
  discovery, reconnect, disconnect, and quarantine behavior.
- [DECISION] Keep the loopback callback URL-decoding behavior and bounded wait
  already covered by the desktop auth implementation. The callback may carry
  encoded authorization data, and a closed or stalled browser must return a
  bounded error instead of waiting forever.

## Acceptance criteria

1. Given a fresh root with usable credentials, when the user activates `Connect
   Google Calendar`, Jin creates or reuses one pending account and starts the
   existing browser authorization flow without requiring an alias-first step.
2. Given no usable credentials, when the user activates the connection action,
   Jin shows setup guidance and an import action before creating an account or
   opening the browser. Canceling the picker leaves no new account.
3. Given a selected file, when it is not a Google installed-app OAuth JSON or
   lacks valid `client_id` and `client_secret` fields, Jin rejects it with a
   precise safe message, leaves the previous config unchanged, and does not
   expose file contents.
4. Given a valid installed-app JSON, when import succeeds, Jin saves the
   credentials to the existing per-vault config and resumes connection without
   requiring a second manual navigation. Environment variables retain priority.
5. Given authorization cancellation, network failure, or token failure, when
   connection ends, Jin keeps at most one retryable pending account, re-enables
   `Retry`, and does not create a duplicate account. Retry reuses that account.
6. Given successful authorization, when Google returns identity, Jin binds the
   account to the immutable validated provider subject, displays the email, and
   discovers calendars. A discovery failure preserves connected authorization and
   exposes `Refresh calendars`.
7. Given an additional account or a reconnect, when the same action is used, Jin
   preserves account isolation, rejects a duplicate provider subject before
   replacing tokens, and retains existing reconnect, disconnect, generation, and
   quarantine rules.
8. Given any import or connection attempt, when IPC, logs, DTOs, errors, audits,
   or exports are produced, client secrets and raw OAuth JSON are absent.

## Verification

Run focused credential/config tests, scripted OAuth and partial-discovery tests,
Settings/controller and Tauri bridge tests, then the GUI test/build checks and
the applicable Rust workspace gates. Native browser handoff and Tauri appearance
remain owner-sign-off evidence.

## Provenance

Sources are the ATLAS trace of `jin-core/src/google/config.rs`,
`jin-core/src/ops/google_accounts.rs`, the Settings controller and markup on
`public/main`, the RAMZA scope handoff, and the FORGE credential-provider verdict
from this change session. [GAP] No distributor OAuth client was supplied, so
zero-configuration release credentials are outside this change.

The archived change record describes this onboarding increment only. Product
scope is the changed core auth/config and account paths, Tauri command and
registration/bridge contracts, Settings UI/controller/styles, deterministic
fixture and tests, plus the README and smoke-test guidance. Existing sync
authority, token storage, and export behavior remain referenced contracts.
