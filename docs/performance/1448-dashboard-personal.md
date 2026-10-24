# Dashboard personal widget delivery

Issue [#1459](https://github.com/Umami-Creative-GmbH/z8/issues/1459), part of
[#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

Birthday Reminders, Hydration, Vacation Balance and Presence Status now use
independent Dashboard server slots and the scoped GET refresh interface. Their
initial snapshots hydrate the existing client query owner without an initial GET.
Each region retains its own loading, error and retry state. Unknown vacation
balances remain unavailable; missing or conflicting policy configuration keeps
its explicit message instead of displaying a numerical zero.

RSC readers reuse the trusted render employee. Shared render settings include
water eligibility and timezone/week-start preferences, so disabled hydration does
not issue another preference or data query. Presence no longer runs a separate
client employee lookup. Every public GET resolves fresh authentication and scope;
client headers cannot grant trusted render preferences or permissions. A disabled
presence policy returns before attendance and absence queries. These personal
reads add no cross-request cache. Hydration Dashboard reads explicitly bypass the
legacy optional leaderboard cache.

The vacation reader calls the existing enhanced vacation service with the
organization year and zone. Allowances, effective policy periods, assigned
holidays and canonical absence-day calculations remain there. The Dashboard
boundary converts carryover expiry Dates to ISO strings. The original action
retains its Date-bearing contract for other callers. Presence shares the original
calculation extracted from its authenticated action, preserving work-policy,
week-start, timezone, work-location and deleted-work-period rules. Wellness intake
days retain the existing command/read calculation so writes and reads agree.

Birthday occurrences use Temporal calendar dates and the organization day. A
birthday on today remains visible after midnight; the previous instant comparison
incorrectly advanced it to next year. Birth dates remain UTC calendar database
values, and only displayed occurrence dates cross the JSON boundary. The query
keeps the current organization roster; inactive and foreign employees are excluded.
February 29 remains a February 29 occurrence. Live avatar clock overlays retain
their operational query owner.

Hydration still executes logWaterIntake and then awaits only its own scoped read.
Confirmed clock-in/out commands invalidate the exact Dashboard presence query in
addition to the existing legacy presence query. The global refresh remains owned
by the RSC refresh provider. Command or local GET completion does not replace the
Dashboard provider, drafts, saved order or customization state.

## Verification evidence

- Red: actual widgets ignored delivered snapshots; green: all four render from
  initial server deliveries with no initial dataset GET.
- Real widgets, QueryClient and fetch hold/fail/retry every personal widget while
  all three siblings remain usable. Only that dataset's two explicit retry GETs
  occur, and an unsaved input remains. Known-disabled deliveries remain hidden.
- Real hydration command UI and clock hook/provider/request tests verify targeted
  read-your-writes, usable controls and an unchanged unsaved draft. The clock test
  failed against the old legacy-only invalidation, then passed after the exact
  Dashboard query was invalidated.
- SectionCards streaming checks cover both completion orders for the two new
  pairs. Public widget GET tests cover all four new IDs with fresh authorization,
  denied scope and independent requests.
- 29 unit files / 222 cases pass for Dashboard, SectionCards, refresh provider,
  public Dashboard routes, presence clock and render preferences. Six additional
  clock/wellness/preference files pass; the extra source guard caveat is below.
- Three PostgreSQL suites / 21 cases pass on the approved disposable fixture:
  personal-widget-reads (10), assigned-vacation-balances and vacation-holidays.
  Unique fixture tenants/users are cleaned through their normal tenant cascade;
  no schema reset or migration is performed. The new suite covers Berlin midnight
  versus UTC day, birthday scope/roster reduction and leap day, known/fresh disabled
  hydration query budgets, the actual water command, missing vacation policy,
  a canonical 30-day allowance with an approved PM half day (29.5 remaining),
  presence/action equivalence, deleted attendance exclusion and an immediate new
  attendance read. Every successful delivery round trips through JSON.
- Phase Development typecheck passes all three configured TypeScript projects.
  Changed source/test Biome checks pass apart from two inherited component-factory
  diagnostics in use-time-clock.presence.test.tsx (the existing wrapper and SSR
  Timer). React Doctor delta from 9ec4ca379 reports 98/100 and no issues. No rule
  suppression or configuration change was added.

## Remaining integration gates

The current-roster source guard still names three action bodies moved by #1457
and #1458: getUpcomingAbsences, getWhosOutToday and getTeamOverviewStats. Those
static assertions fail at current-roster-surfaces.test.ts:484; its full-tree
active-check scan also exceeded its five-second limit at line 522. The real
PostgreSQL current-roster behavior is covered. Final source inventory/catalog
updates and the earlier approval inventory cap remain with the parent integration
work, as explicitly assigned; no baseline or cap was widened here.

Production build, authenticated employee/manager/custom-role browser journeys,
held/failed header clock interaction, actual drag/scroll/layout preservation and
cold/warm paint, request, bytes and ingress measurements remain parent gates.
This document makes no production latency claim. The parent's running original
fixture, collector and service lifecycle were not changed.
