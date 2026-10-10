# CI resource policy

The user accepted the recommended priorities, debounce and review-installer policy on 2026-10-10 during the `grill-with-docs` interview. This document records the agreed direction and recommended execution design. It does not change running workflows or delete existing storage.

## Priorities and success criteria

Restore cache headroom first, reduce superseded work second, and preserve useful feedback speed third. Keep every required suite for a passing change; an optimization must never turn failed, cancelled or missing selected checks into a passing required check.

Aim for active cache storage below 7 GiB after cleanup and warming, leaving approximately 3 GiB of the default allowance for new work. Measure runner time as the sum of individual job durations, separately from workflow wall time and billing. The repository is public and uses standard hosted runners, whose minutes are free. Storage cleanup does not reverse accrued charges; inventory alone does not establish paid cache overage.

## Evidence from 2026-10-10

- 62 cache entries occupied about 9.91 GiB. Eighteen entries belonging to closed PRs accounted for about 7.12 GiB. Removing all eligible entries would leave about 2.79 GiB before warming, new uploads and eviction.
- Eighteen unsigned desktop installers occupied 53.66 MiB. The newest five occupied 14.93 MiB. With only one open PR, the proposed count policy would remove approximately 38.73 MiB before age expiry.
- The recent 100-run sample included 11 cancellations among 20 Tests runs and 10 among 23 Desktop Windows runs. Release PR #927 contained 977 changed files; scope selection correctly sees the complete PR diff and therefore selects every group on successive pushes.
- A bounded audit of the latest eight cancelled runs per workflow found 55m40s across 16 cancelled expensive Tests jobs, and 16m08s across six cancelled Windows jobs. Six Tests jobs and two Windows jobs ended within 90 seconds. Some sampled runs never obtained timed runner jobs; failed jobs in cancelled runs are not included in these cancelled-job totals. These are observed durations, not a prediction of recoverable savings.
- In [run 38036269060](https://github.com/Umami-Creative-GmbH/z8/actions/runs/38036269060), units failed after 5m06s while PostgreSQL ran for 15m14s. Serializing integration would have avoided that database job. Estimated added wall time from sequencing alone is 5-7 minutes. With the 90-second debounce before shards, the combined estimate is 6.5-8.5 minutes relative to the current parallel pipeline; this remains unverified on a green run.

## 1. Remove closed-PR caches

Use a trusted cleanup workflow on PR closure, with scheduled reconciliation for the existing backlog and late cache uploads. Filter precisely to `refs/pull/N/merge`, verify that PR N is closed, and wait for its active producer runs to finish before deleting its entries. Leave branch caches, tag caches and open-PR caches outside this cleanup rule. A reopened PR may need a cold rebuild; caches are disposable acceleration data.

The cleaner only calls metadata/list/delete APIs. Its implementation comes from the trusted default branch and never executes PR code. Give `actions: write` only to the cleanup job, with read access to PR metadata. Paginate inventory, serialize sweeps, and report deleted entry count and bytes. Failures remain visible and scheduled reconciliation retries missed entries.

The first sweep must address old entries, not just future closure events. Verify actual headroom afterward rather than promising the entire snapshot will still be reclaimable.

## 2. Debounce expensive PR validation

Allow scope selection and cheap correctness checks to start immediately. Hold expensive unit shards, PostgreSQL and the Windows runner behind a 90-second Ubuntu debounce. Use the same reusable debounce implementation in Tests and Desktop Windows, while keeping their independent superseded-run cancellation groups. Never spend the delay on an allocated Windows runner.

Scope detection must still inspect every PR file, including old names for renames, and fall back to full coverage on incomplete metadata or API failures. An obsolete run cancelled during the delay must not launch its heavy jobs. A manual diagnostic dispatch may bypass the delay; it still executes the selected suites and remains subject to cancellation.

The delay applies to PR validation generally, including the long-lived release PR. It is a small resource-saving delay, not a guarantee that only stable heads run: updates spaced three to six minutes apart will still start expensive jobs. Do not replace the full PR diff with only the newest commit to improve apparent selectivity.

Measure cancelled runner time and passing-run wall time over a comparable set of pushes. Count the Ubuntu delay runners in the totals. Do not attribute every previously short cancellation to avoidable work because queueing and setup differ between runs.

## 3. Retain unsigned review installers

Keep the newest five unsigned review installers across the repository, plus the newest installer for every open PR. This is a soft cap and may exceed five. Every unsigned review installer expires after 14 days, even the protected newest installer of a quiet open PR. See the [retention ADR](../../.github/docs/adr/0001-unsigned-review-installer-retention.md).

Set `retention-days: 14` on future uploads. The initial sweep must explicitly delete eligible old artifacts because changed retention settings do not shorten existing artifacts' expiry. During reconciliation, delete unsigned installers older than 14 days and excess history, retaining protected installers only inside that age window.

Match both the Desktop Windows producer workflow and the exact unsigned-review artifact name. Exclude signed release candidates, published releases, unrelated artifacts and in-progress producer runs. Associate artifacts with their originating PR rather than guessing from branch names. Record commit and run identity so an installer from a previous head cannot be presented as validation of the current head. A PR without a completed installer does not fabricate a protection candidate.

Serialize cleanup, paginate results, calculate the keep set from a fresh snapshot, and recheck candidates before deletion. A fresh upload or changed PR state must not accidentally remove a newly protected installer. Delete artifacts individually rather than deleting workflow history. Report count, bytes and protected items.

## 4. Run PostgreSQL after selected shards succeed

The recommended default is to start PostgreSQL only after the selected shard matrix passes. Shard 1 currently includes Docker and companion/workspace suites, so this prerequisite is broader than web-app unit tests. Keep those existing suites and the migration-recovery checks intact.

This chooses lower wasted computation over the earliest possible passing result and simultaneous failure diagnostics. A failing unit check remains a failing required check when PostgreSQL is skipped because of that prerequisite. Manual diagnosis may explicitly request PostgreSQL despite a unit failure; that override must never make the combined required check pass.

| Web-app scope | Selected shards | PostgreSQL | Required Tests check |
| --- | --- | --- | --- |
| Unselected | Pass, or correctly unselected | Deliberately skipped | Pass only if every selected check passed |
| Selected | Pass | Executes | Pass only if PostgreSQL also passed |
| Selected | Fail, cancel or missing result | Skipped by prerequisite | Cannot pass |
| Selected, manual diagnostic override | Fail | Executes for diagnosis | Cannot pass |

The 90-second debounce runs before the selected shards; PostgreSQL must not wait another 90 seconds afterward. Together, debounce and sequencing may add approximately 6.5-8.5 minutes to passing-path wall time compared with the current parallel pipeline. This is an estimate, not a measured green-run result. Measure a green run before making a quantified end-to-end speed claim.

## 5. Seed reusable base-branch dependency caches

Seed pnpm stores first, from trusted `dev` code in an independent workflow. Start with one measured warm-up, then seed only after dependency inputs change: the root lockfile, workspace configuration or relevant package manifests. Consolidate rapid updates with concurrency. A matching exact cache hit should avoid a redundant seed install. PR validation must not depend on the seed job succeeding.

Linux warming installs the workspace dependencies; Windows warming installs the desktop dependencies. Match the existing setup-node/pnpm actions, root lockfile selection, platform, architecture and resolved store path. Cache compatibility depends on archive version and paths as well as its displayed key. PRs can restore default/base-branch caches; other PR merge refs cannot share their caches directly.

Keep normal cold-install fallback for changed dependencies, cache misses and eviction. Avoid Windows compilation solely to seed Rust on every push; it could duplicate more work than it saves. Extend warming to Rust only after measuring cold rebuild demand. Do not run frequent scheduled installs simply to keep unused caches alive.

Measure archive restore/upload time, dependency install time, hit rates and added seed runner time. Require a useful net benefit before expanding the warming policy. Separately monitor Vitest generations, whose per-run keys can accumulate despite a shared pnpm seed; closed-PR cleanup remains applicable to them.

## Validation before changing CI

- Test retention selection with multiple PRs, no current-head installer, an old-head rerun, signed candidates, age expiry, pagination and fresh uploads during cleanup.
- Test cache cleanup with open, closed and reopened PRs, active producer runs, branch/tag refs, incomplete inventory and API errors.
- Test every selected/unselected scope and prerequisite-failure combination. Required checks must fail on unexpected skips or missing results.
- Lint workflows and verify permissions and reusable-workflow cancellation behavior. Keep cleaners independent of PR code execution.
- Record a comparable green full run, a scoped desktop run and a short superseded burst. Report cumulative runner time, wall time and storage separately; no invented percentage savings.

## References

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Cache scope, matching and eviction](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Artifact retention inputs](https://github.com/actions/upload-artifact#retention-period)
- [Retention changes apply to new artifacts](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)
- [Artifact API](https://docs.github.com/en/rest/actions/artifacts)
- [Job dependency behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds)
