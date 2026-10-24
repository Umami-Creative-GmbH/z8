# Overtime range evidence (#1465)

The public `AnalyticsService.getOvertimeBurnDown` reader now consumes the shared
`loadAnalyticsRangeEvidence` introduced by #1464. Tracking, completed periods and
requirement inputs are read in serial batches of at most 64 authorized employees.
Cost-center assignments use the same bound. Adding weekly output buckets adds no
database operations. The authenticated action still checks the current employee
and manager visibility on every call; manager and team scope enters the roster SQL
before personal relations or work evidence is loaded.

## PostgreSQL evidence

`apps/webapp/src/lib/analytics/overtime-range.integration.test.ts` runs the actual
reader and authenticated action on the existing migrated disposable PostgreSQL
fixture. Only Next request boundaries and session identity are faked. Production
ORM queries, policies, requirements, employment, holidays and protected allocation
remain real. Query logging observes the caller's actual database client.

The first regression was run before implementation on integration commit
`d184a816e`. The six-person fixture contains four employees with confirmed 40-hour
terms and five completed nine-hour work periods each. Expected weekly overtime is
20 hours. The declared budget of one tracking read and at most two work reads failed:

| Six employees | Before total queries | Before tracking | Before work | After total queries | After tracking | After work |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One week | 130 | 18 | 6 | 15 | 1 | 1 |
| Four weeks | 460 | 72 | 24 | 15 | 1 | 1 |
| Quarter, 14 Monday buckets | — | — | — | 15 | 1 | 1 |
| Year, 53 Monday buckets | — | — | — | 15 | 1 | 1 |

The quarter and year retain exactly 20 total overtime hours. A separate 65-person
roster uses two tracking and two completed-work reads for both one and four weeks,
with identical total query counts. SQL parameters admit at most 64 employee IDs per
work read. With that roster and a pool capped at one connection, the real reader
and concurrent `select 1` probe complete with at most one queued read.

Twenty warm samples per range were collected on the same synthetic fixture using
`Z8_OVERTIME_QUERY_EVIDENCE=1`. The original service source was read from
`d184a816e` into a temporary local module for the comparison, then removed. These
are reader timings within Vitest on this Windows host, not HTTP or browser timings.

| Six employees | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| One week | 47.13 / 67.60 ms | 17.96 / 19.75 ms |
| Four weeks | 145.93 / 282.32 ms | 18.17 / 19.84 ms |

## Calculation contract

Overtime continues to use whole Monday weeks, including weeks partially outside a
selected calendar range. Tracked totals reuse the existing whole-window protected
allocator rather than summing daily chart pieces: an ambiguous break split inside
a week can still have an unambiguous stored weekly total. A period that ambiguously
crosses the tracking or week boundary still requires interval reconciliation.
Database instants are converted once and unrelated weeks are excluded before
protected allocation.

Legacy organizations keep whole stored durations attributed to the UTC start day,
the current effective policy's configured days, organization-wide UTC holiday
exclusions, two-decimal rounding, and inclusive cost-center validity at week start.
They do not substitute tracked confirmed-term requirements or raw elapsed chart
minutes. The shared batch resolves the same employee/team/organization policy
precedence and exposes the policy only to this consumer.

There is one intentional correctness change beyond performance equivalence:
legacy overtime previously counted deleted work. All overtime now applies the
canonical completed-work predicate, excluding deleted and running periods. The
legacy fixture verifies both excluded rows separately from UTC-start attribution
and policy/holiday expectations.

Public-reader expected results cover tracking and employment starts, a protected
rounding split at Monday midnight, the 23-hour Berlin DST day with captured travel
endpoints, a stored break spanning midnight inside a week, blocked ambiguous
boundary work, confirmed versus draft terms, an assigned holiday, a half-day
absence, team/manager/cost-center filters and assignment transitions. Actual action
tests remove manager assignments between calls and deny an ordinary employee
before work retrieval. Tenant tests inspect and replay real work SQL.

## Validation and remaining gates

Focused overtime PostgreSQL tests, existing work-hours and protected-work suites,
overtime unit tests, full TypeScript checking and changed-file lint were run.
Lint retains the existing `any` export types and legacy non-null date assertions.
Required React performance, composition and interface skill checks found no
component or UI changes; the server-action authorization rule applies and is
covered by the real action tests.

Production build, authenticated browser range/filter/error presentation, large live
fixture load, concurrent clock/break readiness, worker/SQL telemetry and release
target measurements remain integration gates for #1448. The one-connection probe
is evidence of bounded reader scheduling, not proof of clock readiness or a
production latency target. No live fixture, production deployment or canonical
work evidence was modified by this implementation.
