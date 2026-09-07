# Contributing to Jin

Jin is a personal project that may be useful to other people. Thoughtful
augmentations, fixes, and suggestions are welcome when they strengthen the
problems Jin was created to solve.

## Start with an issue

Before investing in a large change, open an issue describing the use case,
the proposed shape, and any trade-offs. Small, clearly scoped fixes can go
straight to a pull request when the intent is obvious.

Please keep discussion constructive and specific. There is no implied support
or review SLA.

## Local setup

You will need a current Rust toolchain, Node.js 20+ and npm 10+ for GUI work.

```bash
git clone https://github.com/Rynaro/jin.git
cd jin
make verify
```

For the GUI:

```bash
cd jin-gui
npm ci
cd ..
make verify-gui
```

`make verify-all` runs both verification paths. Prefer focused tests while
iterating, then run the relevant gate before opening a pull request:

```bash
cargo test -p jin-core <test-name>
cargo test -p jin <test-name>
cd jin-gui && npm test -- <test-name>
```

## Pull requests

Keep pull requests focused and explain the user problem they address. Before
requesting review, please check that:

- The relevant verification command passes (`make verify` and/or `make verify-gui`).
- Tests or documentation cover changed behavior where practical.
- The change preserves the local-first, shared-core model unless the issue discusses a deliberate exception.
- No credentials, OAuth tokens, private paths, personal data, or generated local configuration are included.
- UI changes do not claim native visual sign-off solely from headless browser evidence.

If you are unsure whether an idea fits Jin, an issue is the best place to ask.
