# Surface discovered Google calendars

## Intent

Show Google calendars in Jin's Calendar source rail as soon as discovery
finishes, then display inbound events without requiring the user to run Sync.

## Acceptance checks

1. Given a connected Google account with enabled calendars and no local Google
   events yet, when calendar discovery completes, then every discovered calendar
   appears in the Calendar source rail immediately.
2. Given the initial inbound refresh completes, when it imports events, then
   the Calendar view refreshes those events without a manual Sync action.
3. Given initial inbound refresh partially fails, then the connected account and
   discovered source list remain visible, Settings communicates a retry path,
   and Jin does not perform unrelated pending pushes.

## Boundaries

The initial refresh is inbound-only. Existing manual Sync remains the explicit
retry and bidirectional synchronization action.
