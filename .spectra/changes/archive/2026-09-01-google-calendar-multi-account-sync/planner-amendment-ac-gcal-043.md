# Planner amendment — AC-GCAL-043

AC-GCAL-043 must not require changing or proving behavior inside a frozen
historical Jin binary. Current product code cannot retroactively alter an
already-built historical artifact.

The criterion is amended to separate:

1. deterministic fixture evidence for how the frozen historical reader behaves;
2. fail-closed behavior in the current reader/writer and migration guard; and
3. an explicit statement that no current-code patch can make the historical
   binary enforce a newly introduced invariant.

The amended acceptance contract is:

> GIVEN a root carries the v2 account-registry activation marker WHEN the
> current compatibility guard and frozen historical writer behavior are
> evaluated THEN current Jin SHALL reject legacy singleton operations before
> mutation, and lifecycle evidence SHALL record that an already-built
> historical binary is outside current-code enforcement.

Verification combines the current-code guard regression, VIGIL's pinned
historical-binary counterexample, and review of this amendment. The
onboarding/productization slice intentionally makes no product-code change for
the impossible historical-binary portion of the original criterion and makes no
claim that a current patch can alter a previously built executable.

Applied to `change.json`, `spec.yaml`, `spec.md`, and the restored frozen plan on
2026-09-01 before fresh identity-distinct VIGIL verification.
