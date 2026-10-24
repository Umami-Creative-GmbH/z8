# Whole-feature source checks

The fixed comparison is `39a08d0bb`, not the preceding child ticket. Private raw
reports contain fixture diagnostics and stay outside the repository. Build,
compiled-browser and controlled-load acceptance remain separate gates.

## React Doctor

The installed, pinned React Doctor 0.9.17 supports the requested flags. The initial
schema-3 report is usable (`ok: true`, React 19.3 detected): all 213 selected
source files completed, with no skipped checks or degraded baseline. It reports
zero errors and 14 new warnings against the original. Telemetry/score delivery is
disabled, so no numerical health score is claimed. This is not a warning-free
report.

The canonical local-triage playbook and seven rule-family pages were fetched
fresh. Their rule-set metadata is 0.9.3; exact parity with scanner 0.9.17 cannot
be established, so the matching local `rules explain` output was also retained.
No rule, inline suppression or project configuration was changed.

| Occurrences | Outcome and evidence |
| --- | --- |
| Notification channel mutation invalidation | Rejected. The affected settings are RSC props. Successful writes call the router refresh owner; form reset uses the accepted submitted values. No TanStack read owns this dataset. Adding broad invalidation recreates the duplicate-read problem. The rendered refresh/draft regression covers this ownership. |
| Observer's two cache-stream reads | Rejected. Ordered replay followed by tag invalidation is the protocol under test. Concurrent reads would change that protocol. |
| Fixture tracking-context loop | Observation. The bounded disposable setup intentionally validates 208 employees sequentially without adding application/DB load. No throughput defect was established. |
| Projection initializer's array lookup | Rejected. The manifest requires exactly two organizations; the lookup is over those two entries. A map is unnecessary for this bounded validation. |
| Six component/hook complexity warnings | Observation. Employee directory/detail, organization bootstrap, Dashboard GET state and employee read hooks contain explicit scope, eligibility, retry and draft-preservation branches. The counts identify maintainability tradeoffs, not a proven behavior or performance failure. No speculative split was made during release verification. |
| Surcharge model dialog size | Observation. The existing cohesive TanStack form remains intact while its cache invalidation changed. Source length alone does not establish a defect. |
| Upcoming-absence locale formatter | Needs evidence. Its locale follows the active translation language. No allocation/render profile establishes this constructor as a material bottleneck. |
| Analytics/assigned-holiday array lookups (two) | Needs evidence. The selected employee subset is stable within each call, but no CPU profile establishes meaningful cost or a useful crossover. Query-count improvements alone do not prove this CPU bottleneck. |

The separate regression scan for the historical predicate and neutral settings
DTO is complete with zero errors and warnings. The final unfiltered feature scan uses the same executable and original comparison:
all 237 selected source files completed with no skipped checks, zero errors and
the same 14 warnings.

## Biome

The normal full `biome ci src` check fails on the original as well as the feature.
The original snapshot is scanned from its own package directory with the same
installed binary and unchanged package configuration. Windows checkout line
endings contribute formatter differences. Neither raw report is called clean,
and findings in unchanged files are not attributed to this feature.

The introduced import-order assists in wellness actions and calendar readers are
fixed without formatting the surrounding files. The unused AuthService import
left by presence extraction is removed. The Hydration leaderboard's named group
contains rank, name and streak text, with no form controls; converting it into a
fieldset would invent a form-control grouping. Its existing accessible named
group is retained. Formatter/baseline diagnostics remain explicitly reported;
there is no repository-wide formatting rewrite or lint suppression.

## Merged staging-base revalidation

The final validation branch merges staging `ec3414d16` through `9df093b14` and
the prepared mixed-load operator through `a8ddf67eb`. Projection setup tooling is
fixed at `ac2fb1133`; the parent-owned CI build uses that exact pin. Its actual
fresh-fixture cold and hot initialization proof is recorded in
[release preverification](1448-release-preverification.md#fresh-merged-fixture-projection-initialization).
The original compiled worktree remains intact.

Normal license generation and i18n metadata preparation passed. Normal
`pnpm --dir apps/webapp run typecheck` passed both before and after the setup
script change: Next route type generation and all three TypeScript
configurations. The complete React Doctor PR-scope scan against `ec3414d16`
reports schema 3, `ok: true`, 237 analyzed/scanned files, no skipped checks,
zero errors and the same 14 reviewed warnings. No suppression was added.

The focused current-roster, relocated approval owner, inventory and capacity
guards passed 102 assertions, with zero failures. Its deliberate test-name
filter excludes 295 unrelated assertions; that count is not a full-suite pass.
The combined mixed-load and projection operator regression run passed 13 tests
with no skips. The three new projection loader/progress checks are also included
in the normal root and performance test prefixes.

The merged full `biome ci src` run exits 1 with 6,806 errors, 941 warnings and
nine informational diagnostics. It is not clean. The historical original scan
above establishes existing formatter/lint debt; this raw aggregate does not
attribute individual merged diagnostics. Focused Biome checks on the projection
operator changes pass. No broad formatting or guard relaxation was applied.

The merged full normal unit run (maximum two workers) and full normal
PostgreSQL integration run (one worker, no file parallelism) are still pending.
The integration runner owns a new disposable Docker test database and normal
full migrations, including peer `0284`–`0287` and renamed `0288`; the productionlike
final fixtures and old colliding-ledger databases are not used for these tests.
