# Navigation change 2: independent time tracking regions

Time tracking now returns four sibling Suspense boundaries after resolving its authorized employee context. Clock controls await only the active period and the translated employee label when the name is missing. The timeline alone consumes the selected-date promise; summary and history resolve independently. Component tests and the production build verify this structure. Actual authenticated stream delivery and navigation timings remain pending, so this document makes no measured performance claim.

An active-period read failure returns inline retry UI without a clock widget. Ordinary timeline, summary, or history failures stay in their region; completed siblings remain usable. Next redirect, not-found, dynamic-server, and prerender-abort control flow escapes each catch through `unstable_rethrow`. Unknown authorization redirects before protected regions are returned; missing employees retain the existing error screen.

The four existing client leaves retain their props and padding ownership. The outer identity boundary keeps the existing page spacing and h-40/h-64/four h-28/h-80 skeleton geometry, now with accessible loading status. Retry calls `router.refresh()` and never invents a local clock state. Structured timeline failures, display-safe serialization, balance-null behavior, organization-scoped reads, preference defaults, translation keys, canonical actions, providers, and timekeeping calculations remain unchanged. The aggregate page loader has been retired; `page-data.ts` retains only the search-parameter type.

## Verification on October 2, 2026

The predecessor is `0aad2f05b7469fbfd93ac7fa1d88695a74d07bc5`.

| Check | Result |
| --- | --- |
| TDD component tests | RED: missing region modules; GREEN: 22 passing region behavior, composition, error, retry, and loading tests |
| Final focused verification | 14 files, 101 tests passed, including scoped region data, serializer, clock/timeline/summary/history leaves, layout/provider composition, canonical actions, and public action surface |
| Typecheck | `pnpm run typecheck` from `apps/webapp` exit 0, all configured projects |
| Changed-file Biome | Seven source/test files, zero errors or warnings |
| Production build | `CI=true pnpm build` from `apps/webapp` exit 0; 1,438 pages generated, time tracking remains partially prerendered |
| Full unit suite, once | 12,686 passed, 135 failed, 33 skipped; preceding task: 12,667 passed, 135 failed, 33 skipped |
| Failure-name comparison | 134 failing names shared with the preceding task; one prior production-ownership failure absent; one newly observed analyzer 5-second timeout passes in isolation with its unchanged timeout. No newly failing suite |
| React Doctor | Final scan of all seven changed files: no issues introduced against the predecessor. Four JSX-in-try diagnostics were corrected by keeping successful JSX outside data-read try blocks. Numeric score unavailable because the score API is unreachable |

The full suite ran before the final JSX placement correction; the final focused checks, typecheck, build, and React Doctor ran after it. Existing Vite configuration notices and build-only auth/static Tolgee warnings remain. The broader time-tracking group also reproduces three preceding manual-entry date failures; no unrelated fixes were made. The root build wrapper has a known Windows pnpm spawn limitation; the direct app build verifies these changes.

Detailed commands, TDD results, full-suite JSON and failure-name comparison are retained in `.superpowers/sdd/2026-10-02-navigation-time-tracking-streaming/` as ignored local evidence.

## Pending runtime acceptance

Unit tests invoke actual async component functions and inspect their React trees. They do not render an RSC stream or establish browser clock readiness. No authenticated disposable production fixture or approved system configuration was supplied, and no Phase secrets or production mutations were used.

The required production fixture gates remain pending: delay secondary data at a test-process service seam and observe usable clock content before release; then release and observe all regions complete. Verify ordinary/date-only navigation, back/forward, fixture clock mutation plus refresh, no stale enabled clock, no new console/hydration/prerender errors, and layout shifts. Capture stage-2 timings and compare fixed-fixture navigation samples, prefetch behavior, initial JavaScript, and serialized RSC/translation bytes against the [baseline](2026-10-02-navigation-baseline.md).

The [Next dev loop skill](../../../.agents/skills/next-dev-loop/SKILL.md) requires both Next's runtime endpoint and `agent-browser`: “These are hard floors, not soft preferences.” `agent-browser` and the three required Vercel quality skills were unavailable in the controller's preflight. Those checks remain pending; no substitute is claimed as completing them. Whole-branch review and ticket delivery remain controller steps.
