# Publisher Google Desktop OAuth

## Intent

Allow an official Jin desktop release to authorize Google Calendar through one
Connect action while retaining the existing BYO environment and vault-config
paths for source and downstream builds.

## Acceptance checks

1. Given an official build with a complete publisher Desktop OAuth client pair,
   when a fresh initialized vault invokes Connect Google Calendar without BYO
   values, then Jin starts the existing system-browser PKCE flow without a JSON
   import or vault credential write.
2. Given an ordinary source build without an injected publisher pair, when no
   BYO values exist, then Jin retains the current guided BYO setup.
3. Given a complete environment or vault credential source, when a publisher
   client is also compiled into the build, then the established BYO precedence
   remains unchanged.
4. Given the official release pipeline, it rejects missing, incomplete, or
   malformed publisher parameters before packaging; valid values come from the
   `JIN_PUBLISHER_GOOGLE_CLIENT_ID` and
   `JIN_PUBLISHER_GOOGLE_CLIENT_SECRET` GitHub Actions secrets without being
   committed.
5. Given a synthetic publisher client pair, when the resolver and fresh-vault
   flow are tested offline, then no real OAuth client, user token, or live
   Google request is required.

## Boundaries

The increment preserves PKCE, loopback callback handling, token storage,
account isolation, export exclusions, and BYO import/configuration. Google
Cloud project creation, consent-screen publishing, verification submission,
secret creation, and a real account consent round trip remain owner operations.
