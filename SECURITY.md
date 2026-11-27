# Security policy

## Reporting a vulnerability

Please do not disclose an unpatched vulnerability in a public issue or
discussion. Use GitHub Private Vulnerability Reporting instead:

<https://github.com/Rynaro/jin/security/advisories/new>

Private Vulnerability Reporting must be enabled for this repository before it
is made public. Until that is confirmed, do not publish undisclosed security
details.

When you report a vulnerability, include the affected revision or version,
reproducible steps (or other proof), the likely impact, and any possible
mitigation. Please redact personal data and credentials from reports and
attachments.

## Supported versions

Jin is maintained on its current development line. There are no supported
release branches. There is no promised response or remediation SLA; reports are
reviewed as maintainer capacity allows.

## Dependency maintenance routine

Dependabot security updates are enabled and event-driven. The weekly Monday
version-update schedule covers Cargo at `/`, npm at `/jin-gui`, GitHub Actions
at `/`, and Docker at `/`, with patch and minor updates grouped. Security
updates remain independently reviewable. The pull-request dependency review
check fails on newly introduced high or critical vulnerabilities.

Review the [Dependabot alerts](https://github.com/Rynaro/jin/security/dependabot)
and [Dependabot pull requests](https://github.com/Rynaro/jin/pulls?q=is%3Apr+is%3Aopen+author%3Aapp%2Fdependabot),
as well as the [dependency update jobs](https://github.com/Rynaro/jin/network/updates),
every Monday. Triage critical and high alerts the same day, targeting
remediation within 24 hours and three business days respectively. Review
moderate and low alerts weekly, targeting seven and 30 days. These are internal
operating targets and do not change the public reporting policy above.

Track alerts without a bot pull request, failed update jobs, conflicting or
stale pull requests, and updates older than 14 days. Record an owner, affected
package, advisory, mitigation, and dated recheck. After a dependency pull
request merges, confirm the related alert closes on the [alert list](https://github.com/Rynaro/jin/security/dependabot).

On the first Monday of each month, review major-version updates and upstream
release notes before scheduling them. Recheck third-party limitations monthly,
including the Linux-only `glib 0.18.5` alert, `PATCHES.md`, and the upstream
GTK/Tauri replacement path. The reviewed fix is maintained in
[`third-party/glib-0.18.5/PATCHES.md`](third-party/glib-0.18.5/PATCHES.md).
Keep monitoring that backport for new upstream advisories and remove it when
the GTK/Tauri stack supports a fixed published release.

Run the applicable verification gate before merging dependency changes:
`make verify`, `make verify-gui`, or `make verify-all`. Review this routine
quarterly, including notification recipients, dismissed-alert reasons and
expiry dates, stale majors, failed jobs, and unresolved upstream limitations.
