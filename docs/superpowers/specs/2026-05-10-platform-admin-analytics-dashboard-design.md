# Platform Admin Analytics Dashboard Design

## Context

The platform admin area currently has an overview at `/platform-admin` with metric cards for users, banned users, organizations, suspended organizations, and optional billing metrics. Dedicated platform-admin pages already exist for users, organizations, billing, settings, and worker queue operations. The app already includes Recharts and shared chart primitives in `apps/webapp/src/components/ui/chart.tsx`.

The goal is to add platform-level analytics for active users, signups, organizations, seats, sessions, time records, and MRR over time. This is a small/medium scale feature and should use Postgres directly rather than adding ClickHouse, a separate analytics database, or an ingestion worker in the first version.

## Scope

Implement a compact analytics preview on `/platform-admin` and a full analytics dashboard at `/platform-admin/analytics`.

The first version must support user-selectable ranges and validated bucket granularity without introducing new analytics infrastructure. It should be structured so a later snapshot table or analytics database can replace the query implementation without rewriting the UI.

Out of scope:

- ClickHouse or another analytics database.
- Analytics ingestion workers.
- New billing source-of-truth logic.
- Organization-admin access to platform analytics.
- Exporting analytics data.

## Architecture

The new dashboard will use existing source-of-truth tables through server-side Postgres aggregate queries:

- Signups: `user.createdAt`.
- Active users: distinct users with at least one session created inside each bucket. Current active users should use non-expired sessions when shown as a point-in-time KPI.
- Organizations: `organization.createdAt`, excluding deleted organizations for current totals.
- Seats: active subscription `currentSeats` values for current totals when billing is enabled. Historical seat buckets should use `billingSeatAudit` where populated; otherwise they should clearly fall back to current-seat estimates.
- Sessions: `session.createdAt`.
- Time records: canonical `timeRecord` where possible, with legacy `timeEntry` only if needed for compatibility.
- MRR: active, trialing, and past-due subscriptions using the existing platform billing seat pricing calculation. In the first version, MRR over time is an estimate based on available subscription and seat-audit data because the current schema is not a full historical billing ledger.

Analytics query code should be isolated behind a small server-side boundary, such as a platform analytics service or focused query module. Page and chart components should consume normalized analytics data rather than embedding SQL in UI components.

The platform-admin layout already enforces `session.user.role === "admin"`; the analytics route should remain inside that route group and should not expose data through public or organization-scoped endpoints.

## Routes And UI

`/platform-admin` remains the overview page. It should keep its existing metric cards and quick actions, then add a compact "Analytics trends" section with two or three small charts and a clear link to the full analytics dashboard.

`/platform-admin/analytics` is the full dashboard page. It should include:

- A page header with title, description, selected range, and bucket selector.
- KPI cards for active users, signups, organizations, seats, sessions, time records, and MRR.
- A growth chart for signups and organizations over time.
- An engagement chart for active users and sessions over time.
- An operations chart for time records over time.
- A commercial chart for seats and estimated MRR over time when billing is enabled.
- Per-chart empty states when a metric has no data.
- Textual summaries near charts so the page is understandable without relying only on color or hover tooltips.

The platform-admin navigation should add an Analytics item that links to `/platform-admin/analytics`. The compact overview chart should link to the same route.

## Range And Bucket Behavior

The dashboard should read range and bucket values from search params so analytics URLs are shareable. Supported initial ranges are:

- `7d`
- `30d`
- `90d`
- `12m`

Supported buckets are:

- `day`
- `week`
- `month`

Server-side validation must clamp invalid or expensive combinations to safe defaults. The default is `30d` with daily buckets. Bucket generation should zero-fill missing intervals so charts do not skip dates with no data.

## Data Flow

1. A platform admin opens `/platform-admin/analytics?range=90d&bucket=week`.
2. The platform-admin layout verifies authentication and platform-admin role.
3. The analytics page parses and validates `range` and `bucket` search params.
4. The analytics query module runs aggregate queries in parallel where safe.
5. The query module returns normalized KPI values and zero-filled time-series arrays.
6. Server components pass normalized data to small client chart components that use Recharts and the shared `ChartContainer` primitives.

## Error Handling

Invalid search params fall back to the default `30d` and `day` combination. Billing-dependent metrics should be hidden or replaced with a clear unavailable state when billing is disabled. If a chart has no data, it should show an empty state rather than an empty graph.

Database and query failures must not expose raw SQL errors or stack traces to the UI. Where practical, a failed aggregate should degrade only the affected section instead of crashing the entire dashboard. Estimated historical MRR and seat charts should state that exact historical billing reconstruction requires future daily snapshots or a billing ledger.

## Security And Privacy

The dashboard is platform-admin-only and must stay inside the existing platform-admin route protection. It must not add organization-admin access or tenant-scoped analytics endpoints.

The analytics layer should return aggregate counts only. It should not expose raw session tokens, user agent strings, IP addresses, or identifiable per-user records. Query params must be validated server-side to avoid arbitrary expensive scans.

## Testing

Testing should focus on data normalization, validated query params, and route behavior rather than pixel-perfect charts.

Planned coverage:

- Unit tests for range and bucket parsing.
- Tests that invalid range or bucket params fall back safely.
- Tests for bucket generation and zero-filling missing intervals.
- Tests for normalized analytics output from representative aggregate rows.
- Component tests that render KPI cards and chart sections from supplied data.
- Component tests for billing-disabled behavior.
- Component tests for chart empty states.
- Existing platform-admin layout tests updated for the new Analytics nav link.

Verification should use targeted Vitest tests first, then broader `pnpm test` or build/type checks when feasible.

## Future Extension

If analytics volume grows, add a daily snapshot table before introducing a dedicated analytics database. The isolated query module should make that change local to the data layer. ClickHouse and ingestion workers remain a future option for high-volume product analytics, long retention, or arbitrary custom event exploration.
