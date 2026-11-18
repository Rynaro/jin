# Storage runner design

The runner uses Python standard-library filesystem, subprocess and JSON APIs.
Cargo metadata resolves the effective target location. Explicit separate build
directories must be monitored or rejected before execution. A checkout-local lock
serializes guarded operations. External, shared or separate intermediate output is report-only for cleanup.
Cargo cleanup applies only to one Jin package in the dev profile through native
Cargo clean and its locking. Frontend dist remains report-only.

Routine checks default incremental compilation and dev/test debug symbols to zero
through subprocess environment defaults. Explicit caller values and full-debug mode
remain available. Packaging keeps its established target path.

The initial reserve is 5 GiB and expected growth budget is 5 GiB. These are
conservative policy values selected for rollout. Reports supply observations for
tuning. Sampling captures observed free space and can miss shorter-lived peaks.

CI caches Cargo downloads. Rebuilding targets trades CI duration for bounded
restored disk use. Disposable hosted-runner SDK reclamation stays runner-specific.
A native Python test matrix exercises platform behavior on Linux, macOS and Windows.
