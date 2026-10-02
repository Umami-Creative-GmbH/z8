# Navigation change 1: rendering reads

Implementation is structurally verified. Controlled navigation timings and actual RSC request-cache isolation remain pending; this document makes no measured performance claim. Compare runtime results against the [baseline](2026-10-02-navigation-baseline.md) using the approved fixed fixture method before shipping.

The layout and time page share React's request-local session reader. The time page resolves approved membership, active-organization employee, role and presentation preferences once, then passes its validated employee/organization scope to internal readers. Active periods, history and summary use both scope IDs. Guarded helpers keep their existing signatures, resolve the current employee freshly on each call and reject mismatched employee IDs. Active-period reads now also enforce the organization boundary. Readers remain server-only and are not exported as server actions.

History ordering, deleted-period exclusions, ordinary approval request precedence, current-stage assignment targets, UTC durations, captured entry offsets, weekly boundaries and surcharge totals are preserved. The extraction retains the existing date boundary helpers rather than introducing new date business logic. Assigned-project and edit-capability queries are unchanged.

## Verification on October 2, 2026

Task 1 predecessor is `0325fc3af08da20c1d7572b9ae029b6ce0f048ff`; task 2 predecessor is `c6079f91b6048ee7d601327fa43c668647feb815`.

| Check | Result |
| --- | --- |
| Task 1 selected auth/context/page tests | 50 passed, recorded in task 1 report |
| Final combined focused unit checks | 10 suites, 54 passed; `--testTimeout=20000` accommodates the existing cold-import action-surface check |
| Disposable PostgreSQL scoped reads | 5 passed; migration recovery verifier passed, loopback-only labeled container ownership verified and container removed |
| Fresh action authorization | Real PostgreSQL membership deletion denies all three wrappers while employee rows survive; organization switch denies old employee; unit mismatch/default results pass |
| Timekeeping/history fixtures | Sunday/Monday Berlin spring DST totals, stored 60/120-minute offsets, deleted/foreign-org exclusion, newest-first history, strict approval metadata and current-stage assignment targets pass |
| Typecheck | `pnpm --filter webapp typecheck` exit 0, all configured TypeScript projects |
| Touched-file Biome | Eight source/test files, zero errors, nine existing/moved non-null-assertion warnings |
| Repository-wide Biome | `pnpm --filter webapp exec biome ci --max-diagnostics=30 src` fails: 3,704 errors, 814 warnings, one info; no broad fixes made |
| Full unit suite (once per task) | Task 2: 12,637 passed, 135 failed, 33 skipped; task 1: 12,622 passed, 136 failed, 33 skipped |
| Full-suite comparison | 134 failing test names also failed in task 1; two prior analyzer failures absent; one newly observed 15-second fixture-scan timeout passes in isolation with its normal timeout. This does not establish the original product predecessor's full-suite baseline |
| Production app build | `CI=true pnpm build` from `apps/webapp` exit 0, 1,438 pages generated; build-only auth fallback and static Tolgee SSR warnings remain |
| Root build wrapper | Controller observed Windows `scripts/build.mjs` pnpm spawn ENOENT before task 2; direct app build verifies the product changes |
| React Doctor | No diagnostics introduced against task 2 predecessor; numerical score unavailable because score API is unreachable |

Detailed commands, RED/GREEN logs, full-suite JSON and failure-name comparison are retained in `.superpowers/sdd/2026-10-02-navigation-rendering-reads/`. Those execution artifacts are ignored local evidence; this tracked stage file records their conclusions.

## Pending operator gates

No Phase secrets or production database credentials were acquired. An authenticated disposable production-mode fixture environment was not provided. Actual render query counts, inter-request/concurrent-account isolation, organization-switch preference freshness, 20-sample first/repeat navigation median/p95, initial JavaScript and serialized RSC/translation bytes remain unverified. Standard Vitest calls do not establish React request-cache behavior.

The [Next dev loop skill](../../../.agents/skills/next-dev-loop/SKILL.md) requires both Next's runtime endpoint and `agent-browser`: “These are hard floors, not soft preferences.” The controller's preflight found `agent-browser` unavailable, so that runtime workflow remains pending. The three required Vercel quality skills are also unavailable in the installed catalog. No tooling/dependency installation or weaker substitute is claimed as completing those gates.

Whole-branch review and the ticket PR to `dev` are controller delivery steps. No push, merge or deployment is included in this task's scoped-read commit.

## Final review repair

The final review found that the render context rejected every `banned: true` user, including an authoritative valid session whose temporary ban had expired. It now calls the existing expiry-aware `isAccountBanned` policy. Active and permanent bans still deny before employee/settings I/O; an expired temporary ban returns the authorized organization-scoped employee context and the real page composition reaches its clock region without the session-expired redirect. No fresh action, membership, SSO, reader or timekeeping predicates changed.

The expired-ban regression failed before the source change and passed afterward; the focused policy/context run has 30 passing tests. Final combined coverage has 343 passing tests in 31 files, and the configured typecheck, direct app production build (1,438 pages), four-file Biome and React Doctor checks pass. Doctor's numerical score is unavailable. See the [final baseline update](2026-10-02-navigation-baseline.md#final-review-repair-evidence) for the full-suite result and unchanged acceptance gates.
