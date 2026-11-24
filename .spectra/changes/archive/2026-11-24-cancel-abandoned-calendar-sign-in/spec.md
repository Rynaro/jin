# Cancel abandoned Google Calendar sign-in

## Intent

Let a user abandon an in-flight Google browser authorization without leaving
Calendars & Sync blocked. The user can cancel, continue using settings, and
retry the same account safely.

## Acceptance checks

1. Given Google sign-in is waiting for a browser callback, when the user
   cancels in Jin, then the waiting native operation ends promptly and every
   Google connection control returns to an actionable state.
2. Given Google sign-in is waiting, when the user changes another Calendar &
   Sync setting, then that independent setting remains usable.
3. Given an abandoned new-account attempt, when the user retries, then Jin
   reuses the pending account instead of creating a duplicate.
4. Given an old callback arrives after cancellation or after a newer attempt
   starts, when Jin receives it, then it cannot complete or overwrite the newer
   attempt.
5. Given cancellation or timeout, then the account remains pending and no user
   token, connected identity, calendar selection, or existing account is
   changed.

## Boundaries

The change preserves the existing system-browser OAuth, loopback callback,
PKCE, account-specific token storage, publisher credentials, and BYO client
paths. Cancellation is scoped to the active authorization attempt.
