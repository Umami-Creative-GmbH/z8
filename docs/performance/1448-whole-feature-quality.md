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

The merged full normal unit run passed with a maximum of two workers: 19,505
tests passed, zero failed and 38 existing skips; 1,817 files passed and five
existing files were skipped. It completed in 1,189.65 seconds with the normal
i18n metadata prerequisite. The full normal PostgreSQL integration run (one
worker, no file parallelism) exited 1: 5,628 passed, 214 failed and eight skipped.
That original command and its raw failure evidence remain failed.
The integration runner owns a new disposable Docker test database and normal
full migrations, including peer `0284`–`0287` and renamed `0288`; the productionlike
final fixtures and old colliding-ledger databases are not used for these tests.

All 12 failing files supplied incomplete local authenticated-session fixtures,
missing the session ID and subject user ID. The separate scoped-read revocation
case failed on its initial authorized read for the same reason. Sixteen local
fixture objects now provide `id`, `userId` and `activeOrganizationId`; no shared
authentication helper, business reader, transaction or admission guard changed.

A new normal disposable Docker run replayed the **entire 12 affected files**:
300 passed, zero failed and one existing skipped task-booking case. All 214
original failures are resolved by this replay. These counts overlap the first
run and must not be added to its 5,628 passes or described as a clean full-run
command. The normal runner removed its own fresh container after completion;
file-local cleanup remains unchanged. All three TypeScript configurations pass
again after the fixture edits. Focused Biome on these files retains their
existing Windows line-ending formatter differences; no broad formatting was done.

## Production-input quality refresh

The later refresh at integration `6e034d5346ec1253a790314546b7fe6401294af2`
uses the same production inputs as compiled application
`b287acdc272cf0ef8f6a208ca288fade8f150166`. Subsequent observer-only changes
retain that application qualification; their pure harness tests are separate.

The quiet full unit replay passed **19,541 tests, zero failed and 38 existing
skips**, across 1,823 passed files and five skipped files. It used two workers,
completed in 951.40 seconds, and ran with browser and integration work stopped.
Test code and timeouts were unchanged. The preceding full attempt remains a
failed run: 19,540 passed and one unchanged source scanner exceeded its existing
five-second timeout. The scanner separately passed in 447 ms; neither replay
erases that recorded failure.

The fresh full PostgreSQL command remains **failed**: 5,707 passed, 135 failed
and eight skipped, across 482 passed files, two failed files and one skipped
file. The failures are in `work-period-approvals.integration.test.ts` and
`legacy-time-bound-approval.integration.test.ts`, whose inspected source is
unchanged from the original and staging comparison. The inherited raw-pool UTC
options shadow the intended statement timeout. One query was cancelled after
more than 29 minutes so the failed run could clean up; no deadlock or clean
full-suite result is claimed. Its owned disposable container was removed.

Retained raw-log SHA-256 identities:

| Run | SHA-256 |
| --- | --- |
| Quiet full unit replay | `99e452b068974f87761efb93796a635047c4662550bb88c9eff39be6d6969d57` |
| Earlier failed unit run | `e38eebc882e9e9d2edc4fb5abb489a544af1329c22b13942701d00a72e0e777f` |
| Full PostgreSQL command | `278246876e24e96fbdc3936a01f4b06981626b9ee6137098c7bd65a27dd2f022` |

The combined quality receipt has SHA-256
`9f4451f68d670b46f2c418688072d57cb3d27f7606069299125d0b74715e14fc`.
Controlled original/optimized performance acceptance remains a separate,
unfulfilled gate; these source checks and retained failures do not supply it.
