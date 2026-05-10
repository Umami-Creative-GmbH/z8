# Platform Admin Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Postgres-backed platform-admin analytics preview and full dashboard for users, signups, organizations, seats, sessions, time records, and estimated MRR over time.

**Architecture:** Keep analytics Postgres-only for this version. Put range parsing, bucket generation, row normalization, and aggregate queries behind focused server-side modules under `apps/webapp/src/lib/platform-analytics`, then render charts through small client components using the existing Recharts `ChartContainer`. Add a compact analytics preview to `/platform-admin` and a full dashboard route at `/platform-admin/analytics`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, Postgres, Luxon, Recharts, Vitest, Testing Library.

---

## File Structure

- Create `apps/webapp/src/lib/platform-analytics/types.ts`
  Defines shared range, bucket, KPI, series, and aggregate row types.
- Create `apps/webapp/src/lib/platform-analytics/range.ts`
  Parses `range` and `bucket` search params, clamps unsupported combinations, and generates zero-filled bucket metadata using Luxon.
- Create `apps/webapp/src/lib/platform-analytics/range.test.ts`
  Covers safe param parsing and bucket generation.
- Create `apps/webapp/src/lib/platform-analytics/normalize.ts`
  Merges aggregate rows into zero-filled time-series points and computes summaries.
- Create `apps/webapp/src/lib/platform-analytics/normalize.test.ts`
  Covers zero-fill, merge behavior, and estimated billing flags.
- Create `apps/webapp/src/lib/platform-analytics/service.ts`
  Runs platform aggregate queries against existing tables and returns normalized analytics data.
- Create `apps/webapp/src/components/platform-admin/platform-analytics-charts.tsx`
  Client chart components for compact and full dashboard chart cards.
- Create `apps/webapp/src/components/platform-admin/platform-analytics-charts.test.tsx`
  Verifies chart cards, empty states, summaries, and billing-disabled rendering.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx`
  Server route for the full analytics dashboard.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx`
  Client controls that update `range` and `bucket` search params.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
  Adds a compact analytics preview section below platform metrics.
- Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
  Adds an Analytics navigation link.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`
  Verifies the Analytics nav link is present.
- Modify `apps/webapp/src/tolgee/shared.ts`
  Keeps `/platform-admin/analytics` loading the admin namespace.
- Modify `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts`
  Covers the analytics route namespace mapping.

---

### Task 1: Range And Bucket Utilities

**Files:**
- Create: `apps/webapp/src/lib/platform-analytics/types.ts`
- Create: `apps/webapp/src/lib/platform-analytics/range.ts`
- Test: `apps/webapp/src/lib/platform-analytics/range.test.ts`

- [ ] **Step 1: Write failing tests for search param parsing and bucket generation**

Create `apps/webapp/src/lib/platform-analytics/range.test.ts` with this content:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildPlatformAnalyticsBuckets, parsePlatformAnalyticsParams } from "./range";

const NOW = DateTime.fromISO("2026-05-10T12:00:00Z", { zone: "utc" });

describe("parsePlatformAnalyticsParams", () => {
	it("defaults to 30 days with daily buckets", () => {
		expect(parsePlatformAnalyticsParams({}, NOW)).toMatchObject({
			range: "30d",
			bucket: "day",
		});
	});

	it("accepts supported range and bucket combinations", () => {
		expect(parsePlatformAnalyticsParams({ range: "90d", bucket: "week" }, NOW)).toMatchObject({
			range: "90d",
			bucket: "week",
		});
		expect(parsePlatformAnalyticsParams({ range: "12m", bucket: "month" }, NOW)).toMatchObject({
			range: "12m",
			bucket: "month",
		});
	});

	it("clamps unsupported bucket combinations", () => {
		expect(parsePlatformAnalyticsParams({ range: "12m", bucket: "day" }, NOW)).toMatchObject({
			range: "12m",
			bucket: "month",
		});
	});

	it("falls back when params are invalid", () => {
		expect(parsePlatformAnalyticsParams({ range: "all", bucket: "minute" }, NOW)).toMatchObject({
			range: "30d",
			bucket: "day",
		});
	});
});

describe("buildPlatformAnalyticsBuckets", () => {
	it("builds daily buckets with ISO keys and labels", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);

		expect(buckets).toHaveLength(7);
		expect(buckets[0]).toEqual({
			key: "2026-05-04",
			label: "May 4",
			startIso: "2026-05-04T00:00:00.000Z",
			endIso: "2026-05-05T00:00:00.000Z",
		});
		expect(buckets[6]?.key).toBe("2026-05-10");
	});

	it("builds monthly buckets for twelve month ranges", () => {
		const params = parsePlatformAnalyticsParams({ range: "12m", bucket: "month" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);

		expect(buckets).toHaveLength(12);
		expect(buckets[0]?.key).toBe("2025-06");
		expect(buckets[11]?.key).toBe("2026-05");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/lib/platform-analytics/range.test.ts`

Expected: FAIL because `apps/webapp/src/lib/platform-analytics/range.ts` does not exist.

- [ ] **Step 3: Add shared analytics types**

Create `apps/webapp/src/lib/platform-analytics/types.ts` with this content:

```ts
export const PLATFORM_ANALYTICS_RANGES = ["7d", "30d", "90d", "12m"] as const;
export const PLATFORM_ANALYTICS_BUCKETS = ["day", "week", "month"] as const;

export type PlatformAnalyticsRange = (typeof PLATFORM_ANALYTICS_RANGES)[number];
export type PlatformAnalyticsBucket = (typeof PLATFORM_ANALYTICS_BUCKETS)[number];

export type PlatformAnalyticsSearchParams = {
	range?: string | string[];
	bucket?: string | string[];
};

export type ParsedPlatformAnalyticsParams = {
	range: PlatformAnalyticsRange;
	bucket: PlatformAnalyticsBucket;
	startIso: string;
	endIso: string;
};

export type PlatformAnalyticsBucketInfo = {
	key: string;
	label: string;
	startIso: string;
	endIso: string;
};

export type PlatformAnalyticsMetricKey =
	| "signups"
	| "organizations"
	| "activeUsers"
	| "sessions"
	| "timeRecords"
	| "seats"
	| "mrr";

export type PlatformAnalyticsAggregateRow = {
	bucket: Date | string;
	value: number | string | null;
};

export type PlatformAnalyticsPoint = {
	bucketKey: string;
	label: string;
	signups: number;
	organizations: number;
	activeUsers: number;
	sessions: number;
	timeRecords: number;
	seats: number | null;
	mrr: number | null;
	estimatedBilling: boolean;
};

export type PlatformAnalyticsKpis = {
	activeUsers: number;
	signups: number;
	organizations: number;
	seats: number | null;
	sessions: number;
	timeRecords: number;
	mrr: number | null;
	estimatedBilling: boolean;
};

export type PlatformAnalyticsData = {
	params: ParsedPlatformAnalyticsParams;
	billingEnabled: boolean;
	kpis: PlatformAnalyticsKpis;
	series: PlatformAnalyticsPoint[];
};
```

- [ ] **Step 4: Implement range and bucket utilities**

Create `apps/webapp/src/lib/platform-analytics/range.ts` with this content:

```ts
import { DateTime } from "luxon";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsBucket,
	PlatformAnalyticsBucketInfo,
	PlatformAnalyticsRange,
	PlatformAnalyticsSearchParams,
} from "./types";

const DEFAULT_RANGE: PlatformAnalyticsRange = "30d";
const DEFAULT_BUCKET_BY_RANGE: Record<PlatformAnalyticsRange, PlatformAnalyticsBucket> = {
	"7d": "day",
	"30d": "day",
	"90d": "week",
	"12m": "month",
};

const SUPPORTED_BUCKETS_BY_RANGE: Record<PlatformAnalyticsRange, PlatformAnalyticsBucket[]> = {
	"7d": ["day"],
	"30d": ["day", "week"],
	"90d": ["day", "week", "month"],
	"12m": ["week", "month"],
};

function firstParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

function isRange(value: string | undefined): value is PlatformAnalyticsRange {
	return value === "7d" || value === "30d" || value === "90d" || value === "12m";
}

function isBucket(value: string | undefined): value is PlatformAnalyticsBucket {
	return value === "day" || value === "week" || value === "month";
}

function getRangeStart(range: PlatformAnalyticsRange, now: DateTime): DateTime {
	const today = now.setZone("utc").startOf("day");

	if (range === "12m") {
		return today.minus({ months: 11 }).startOf("month");
	}

	const days = range === "7d" ? 6 : range === "30d" ? 29 : 89;
	return today.minus({ days });
}

export function parsePlatformAnalyticsParams(
	searchParams: PlatformAnalyticsSearchParams,
	now: DateTime = DateTime.utc(),
): ParsedPlatformAnalyticsParams {
	const rangeParam = firstParam(searchParams.range);
	const bucketParam = firstParam(searchParams.bucket);
	const range = isRange(rangeParam) ? rangeParam : DEFAULT_RANGE;
	const requestedBucket = isBucket(bucketParam) ? bucketParam : DEFAULT_BUCKET_BY_RANGE[range];
	const bucket = SUPPORTED_BUCKETS_BY_RANGE[range].includes(requestedBucket)
		? requestedBucket
		: DEFAULT_BUCKET_BY_RANGE[range];
	const start = getRangeStart(range, now);
	const end = now.setZone("utc").startOf("day").plus({ days: 1 });

	return {
		range,
		bucket,
		startIso: start.toISO(),
		endIso: end.toISO(),
	};
}

export function getPlatformAnalyticsBucketOptions(range: PlatformAnalyticsRange) {
	return SUPPORTED_BUCKETS_BY_RANGE[range];
}

export function buildPlatformAnalyticsBuckets(
	params: ParsedPlatformAnalyticsParams,
): PlatformAnalyticsBucketInfo[] {
	const buckets: PlatformAnalyticsBucketInfo[] = [];
	let cursor = DateTime.fromISO(params.startIso, { zone: "utc" });
	const end = DateTime.fromISO(params.endIso, { zone: "utc" });

	while (cursor < end) {
		const next = cursor.plus({ [params.bucket === "day" ? "days" : params.bucket === "week" ? "weeks" : "months"]: 1 });
		const key = params.bucket === "month" ? cursor.toFormat("yyyy-MM") : cursor.toISODate();
		const label =
			params.bucket === "month"
				? cursor.toFormat("LLL yyyy")
				: cursor.toLocaleString({ month: "short", day: "numeric" });

		buckets.push({
			key,
			label,
			startIso: cursor.toISO(),
			endIso: next.toISO(),
		});

		cursor = next;
	}

	return buckets;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter webapp test src/lib/platform-analytics/range.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit range utilities**

```bash
git add apps/webapp/src/lib/platform-analytics/types.ts apps/webapp/src/lib/platform-analytics/range.ts apps/webapp/src/lib/platform-analytics/range.test.ts
git commit -m "feat: add platform analytics range utilities"
```

---

### Task 2: Normalize Aggregate Rows

**Files:**
- Create: `apps/webapp/src/lib/platform-analytics/normalize.ts`
- Test: `apps/webapp/src/lib/platform-analytics/normalize.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Create `apps/webapp/src/lib/platform-analytics/normalize.test.ts` with this content:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildPlatformAnalyticsBuckets, parsePlatformAnalyticsParams } from "./range";
import { buildPlatformAnalyticsSeries, getLatestPointKpis } from "./normalize";

const NOW = DateTime.fromISO("2026-05-10T12:00:00Z", { zone: "utc" });

describe("buildPlatformAnalyticsSeries", () => {
	it("zero-fills missing metric buckets", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(buckets, {
			signups: [{ bucket: "2026-05-04T00:00:00.000Z", value: 3 }],
			organizations: [{ bucket: "2026-05-05T00:00:00.000Z", value: "2" }],
			activeUsers: [],
			sessions: [],
			timeRecords: [],
			seats: [],
			mrr: [],
		}, false);

		expect(series).toHaveLength(7);
		expect(series[0]).toMatchObject({
			bucketKey: "2026-05-04",
			signups: 3,
			organizations: 0,
			seats: null,
			mrr: null,
			estimatedBilling: false,
		});
		expect(series[1]).toMatchObject({ signups: 0, organizations: 2 });
	});

	it("marks billing series as estimated when supplied", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(buckets, {
			signups: [],
			organizations: [],
			activeUsers: [],
			sessions: [],
			timeRecords: [],
			seats: [{ bucket: "2026-05-10T00:00:00.000Z", value: 42 }],
			mrr: [{ bucket: "2026-05-10T00:00:00.000Z", value: 168 }],
		}, true);

		expect(series[6]).toMatchObject({ seats: 42, mrr: 168, estimatedBilling: true });
	});
});

describe("getLatestPointKpis", () => {
	it("uses latest point values plus supplied current totals", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(buckets, {
			signups: [{ bucket: "2026-05-10T00:00:00.000Z", value: 4 }],
			organizations: [],
			activeUsers: [{ bucket: "2026-05-10T00:00:00.000Z", value: 9 }],
			sessions: [{ bucket: "2026-05-10T00:00:00.000Z", value: 12 }],
			timeRecords: [{ bucket: "2026-05-10T00:00:00.000Z", value: 100 }],
			seats: [],
			mrr: [],
		}, false);

		expect(
			getLatestPointKpis(series, {
				organizations: 7,
				seats: null,
				mrr: null,
				estimatedBilling: false,
			}),
		).toEqual({
				activeUsers: 9,
				signups: 4,
				organizations: 7,
				seats: null,
				sessions: 12,
				timeRecords: 100,
				mrr: null,
				estimatedBilling: false,
			});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/lib/platform-analytics/normalize.test.ts`

Expected: FAIL because `normalize.ts` does not exist.

- [ ] **Step 3: Implement normalization helpers**

Create `apps/webapp/src/lib/platform-analytics/normalize.ts` with this content:

```ts
import { DateTime } from "luxon";
import type {
	PlatformAnalyticsAggregateRow,
	PlatformAnalyticsBucketInfo,
	PlatformAnalyticsKpis,
	PlatformAnalyticsMetricKey,
	PlatformAnalyticsPoint,
} from "./types";

type MetricRows = Record<PlatformAnalyticsMetricKey, PlatformAnalyticsAggregateRow[]>;

const METRIC_KEYS: PlatformAnalyticsMetricKey[] = [
	"signups",
	"organizations",
	"activeUsers",
	"sessions",
	"timeRecords",
	"seats",
	"mrr",
];

function bucketKeyFromValue(value: Date | string): string {
	const dateTime = value instanceof Date ? DateTime.fromJSDate(value, { zone: "utc" }) : DateTime.fromISO(value, { zone: "utc" });
	return dateTime.toISODate() ?? dateTime.toFormat("yyyy-MM");
}

function normalizeNumber(value: number | string | null): number {
	if (value === null) {
		return 0;
	}

	return Number(value) || 0;
}

function rowsToMap(rows: PlatformAnalyticsAggregateRow[]) {
	return new Map(rows.map((row) => [bucketKeyFromValue(row.bucket), normalizeNumber(row.value)]));
}

export function buildPlatformAnalyticsSeries(
	buckets: PlatformAnalyticsBucketInfo[],
	rows: MetricRows,
	estimatedBilling: boolean,
): PlatformAnalyticsPoint[] {
	const maps = Object.fromEntries(
		METRIC_KEYS.map((metric) => [metric, rowsToMap(rows[metric])]),
	) as Record<PlatformAnalyticsMetricKey, Map<string, number>>;

	return buckets.map((bucket) => {
		const seats = maps.seats.get(bucket.key) ?? null;
		const mrr = maps.mrr.get(bucket.key) ?? null;

		return {
			bucketKey: bucket.key,
			label: bucket.label,
			signups: maps.signups.get(bucket.key) ?? 0,
			organizations: maps.organizations.get(bucket.key) ?? 0,
			activeUsers: maps.activeUsers.get(bucket.key) ?? 0,
			sessions: maps.sessions.get(bucket.key) ?? 0,
			timeRecords: maps.timeRecords.get(bucket.key) ?? 0,
			seats,
			mrr,
			estimatedBilling,
		};
	});
}

export function getLatestPointKpis(
	series: PlatformAnalyticsPoint[],
	currentTotals: Pick<PlatformAnalyticsKpis, "organizations" | "seats" | "mrr" | "estimatedBilling">,
): PlatformAnalyticsKpis {
	const latest = series.at(-1);

	return {
		activeUsers: latest?.activeUsers ?? 0,
		signups: latest?.signups ?? 0,
		organizations: currentTotals.organizations,
		seats: currentTotals.seats,
		sessions: latest?.sessions ?? 0,
		timeRecords: latest?.timeRecords ?? 0,
		mrr: currentTotals.mrr,
		estimatedBilling: currentTotals.estimatedBilling,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter webapp test src/lib/platform-analytics/normalize.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit normalization helpers**

```bash
git add apps/webapp/src/lib/platform-analytics/normalize.ts apps/webapp/src/lib/platform-analytics/normalize.test.ts
git commit -m "feat: normalize platform analytics series"
```

---

### Task 3: Postgres Analytics Service

**Files:**
- Create: `apps/webapp/src/lib/platform-analytics/service.ts`
- Test: `apps/webapp/src/lib/platform-analytics/range.test.ts`
- Test: `apps/webapp/src/lib/platform-analytics/normalize.test.ts`

- [ ] **Step 1: Add the service implementation**

Create `apps/webapp/src/lib/platform-analytics/service.ts` with this content:

```ts
import { and, count, countDistinct, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization, session, user } from "@/db/auth-schema";
import { billingSeatAudit, subscription, timeRecord } from "@/db/schema";
import { buildPlatformAnalyticsBuckets } from "./range";
import { buildPlatformAnalyticsSeries, getLatestPointKpis } from "./normalize";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsAggregateRow,
	PlatformAnalyticsBucket,
	PlatformAnalyticsData,
} from "./types";

const ACTIVE_BILLING_STATUSES = ["active", "trialing", "past_due"] as const;

function bucketSql(column: unknown, bucket: PlatformAnalyticsBucket) {
	const wrappedColumn = sql`${column}`;

	switch (bucket) {
		case "day":
			return sql<Date>`date_trunc('day', ${wrappedColumn})`;
		case "week":
			return sql<Date>`date_trunc('week', ${wrappedColumn})`;
		case "month":
			return sql<Date>`date_trunc('month', ${wrappedColumn})`;
	}
}

function bucketInterval(bucket: PlatformAnalyticsBucket) {
	switch (bucket) {
		case "day":
			return sql.raw("interval '1 day'");
		case "week":
			return sql.raw("interval '1 week'");
		case "month":
			return sql.raw("interval '1 month'");
	}
}

function pricePerSeatForInterval(interval: string | null) {
	return interval === "year" ? 3 : 4;
}

async function getCountByBucket(
	dateColumn: unknown,
	fromTable: Parameters<typeof db.select>[0],
	params: ParsedPlatformAnalyticsParams,
): Promise<PlatformAnalyticsAggregateRow[]> {
	const bucket = bucketSql(dateColumn, params.bucket);

	return db
		.select({ bucket, value: count() })
		.from(fromTable as never)
		.where(and(gte(dateColumn as never, new Date(params.startIso)), lt(dateColumn as never, new Date(params.endIso))))
		.groupBy(bucket)
		.orderBy(bucket);
}

async function getActiveUsersByBucket(params: ParsedPlatformAnalyticsParams) {
	const bucket = bucketSql(session.createdAt, params.bucket);

	return db
		.select({ bucket, value: countDistinct(session.userId) })
		.from(session)
		.where(and(gte(session.createdAt, new Date(params.startIso)), lt(session.createdAt, new Date(params.endIso))))
		.groupBy(bucket)
		.orderBy(bucket);
}

async function getBillingSnapshotRows(params: ParsedPlatformAnalyticsParams) {
	const interval = bucketInterval(params.bucket);
	const result = await db.execute(sql<{
		bucket: Date;
		seats: string | number | null;
		mrr: string | number | null;
	}[]>`
		WITH buckets AS (
			SELECT generate_series(
				${new Date(params.startIso)}::timestamp,
				(${new Date(params.endIso)}::timestamp - ${interval}),
				${interval}
			) AS bucket
		), active_subscriptions AS (
			SELECT organization_id, billing_interval, current_seats
			FROM subscription
			WHERE status IN ('active', 'trialing', 'past_due')
		)
		SELECT
			buckets.bucket,
			COALESCE(SUM(COALESCE(latest_seats.new_seats, active_subscriptions.current_seats, 0)), 0) AS seats,
			COALESCE(SUM(
				COALESCE(latest_seats.new_seats, active_subscriptions.current_seats, 0) *
				CASE WHEN active_subscriptions.billing_interval = 'year' THEN 3 ELSE 4 END
			), 0) AS mrr
		FROM buckets
		LEFT JOIN active_subscriptions ON true
		LEFT JOIN LATERAL (
			SELECT new_seats
			FROM billing_seat_audit
			WHERE billing_seat_audit.organization_id = active_subscriptions.organization_id
				AND billing_seat_audit.created_at <= buckets.bucket
			ORDER BY billing_seat_audit.created_at DESC
			LIMIT 1
		) latest_seats ON true
		GROUP BY buckets.bucket
		ORDER BY buckets.bucket
	`);

	const rows = Array.from(result.rows ?? result);

	return {
		seats: rows.map((row) => ({ bucket: row.bucket, value: row.seats })),
		mrr: rows.map((row) => ({ bucket: row.bucket, value: row.mrr })),
	};
}

async function getCurrentBillingTotals() {
	const activeSubscriptions = await db
		.select({
			currentSeats: subscription.currentSeats,
			billingInterval: subscription.billingInterval,
		})
		.from(subscription)
		.where(sql`${subscription.status} IN ('active', 'trialing', 'past_due')`);

	return activeSubscriptions.reduce(
		(totals, row) => {
			const seats = row.currentSeats ?? 0;
			return {
				seats: totals.seats + seats,
				mrr: totals.mrr + seats * pricePerSeatForInterval(row.billingInterval),
			};
		},
		{ seats: 0, mrr: 0 },
	);
}

export async function getPlatformAnalyticsData(
	params: ParsedPlatformAnalyticsParams,
	billingEnabled = process.env.BILLING_ENABLED === "true",
): Promise<PlatformAnalyticsData> {
	const buckets = buildPlatformAnalyticsBuckets(params);
	const [
		signups,
		organizations,
		activeUsers,
		sessions,
		timeRecords,
		[{ organizationCount }],
		billingTotals,
		billingRows,
	] = await Promise.all([
		getCountByBucket(user.createdAt, user as never, params),
		getCountByBucket(organization.createdAt, organization as never, params),
		getActiveUsersByBucket(params),
		getCountByBucket(session.createdAt, session as never, params),
		getCountByBucket(timeRecord.createdAt, timeRecord as never, params),
		db
			.select({ organizationCount: count() })
			.from(organization)
			.where(isNull(organization.deletedAt)),
		billingEnabled ? getCurrentBillingTotals() : Promise.resolve({ seats: null, mrr: null }),
		billingEnabled ? getBillingSnapshotRows(params) : Promise.resolve({ seats: [], mrr: [] }),
	]);

	const series = buildPlatformAnalyticsSeries(
		buckets,
		{
			signups,
			organizations,
			activeUsers,
			sessions,
			timeRecords,
			seats: billingRows.seats,
			mrr: billingRows.mrr,
		},
		billingEnabled,
	);

	return {
		params,
		billingEnabled,
		series,
		kpis: getLatestPointKpis(series, {
			organizations: organizationCount,
			seats: billingTotals.seats,
			mrr: billingTotals.mrr,
			estimatedBilling: billingEnabled,
		}),
	};
}
```

- [ ] **Step 2: Run typecheck-focused tests**

Run: `pnpm --filter webapp test src/lib/platform-analytics/range.test.ts src/lib/platform-analytics/normalize.test.ts`

Expected: PASS. If TypeScript reports a Drizzle generic mismatch in `getCountByBucket`, replace that helper with five explicit query functions using the same `bucketSql` expression and rerun this command.

- [ ] **Step 3: Commit the analytics service**

```bash
git add apps/webapp/src/lib/platform-analytics/service.ts
git commit -m "feat: query platform analytics aggregates"
```

---

### Task 4: Chart Components

**Files:**
- Create: `apps/webapp/src/components/platform-admin/platform-analytics-charts.tsx`
- Test: `apps/webapp/src/components/platform-admin/platform-analytics-charts.test.tsx`

- [ ] **Step 1: Write failing chart component tests**

Create `apps/webapp/src/components/platform-admin/platform-analytics-charts.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlatformAnalyticsData } from "@/lib/platform-analytics/types";
import { PlatformAnalyticsCharts, PlatformAnalyticsPreviewCharts } from "./platform-analytics-charts";

vi.mock("next/dynamic", () => ({
	default: () =>
		function DynamicChartMock({ children }: { children?: React.ReactNode }) {
			return <div data-testid="dynamic-chart">{children}</div>;
		},
}));

vi.mock("@/components/ui/chart", () => ({
	ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ChartTooltip: () => null,
	ChartTooltipContent: () => null,
}));

function createData(overrides: Partial<PlatformAnalyticsData> = {}): PlatformAnalyticsData {
	return {
		params: {
			range: "30d",
			bucket: "day",
			startIso: "2026-04-11T00:00:00.000Z",
			endIso: "2026-05-11T00:00:00.000Z",
		},
		billingEnabled: true,
		kpis: {
			activeUsers: 11,
			signups: 4,
			organizations: 7,
			seats: 42,
			sessions: 18,
			timeRecords: 130,
			mrr: 168,
			estimatedBilling: true,
		},
		series: [
			{
				bucketKey: "2026-05-10",
				label: "May 10",
				signups: 4,
				organizations: 1,
				activeUsers: 11,
				sessions: 18,
				timeRecords: 130,
				seats: 42,
				mrr: 168,
				estimatedBilling: true,
			},
		],
		...overrides,
	};
}

describe("PlatformAnalyticsCharts", () => {
	it("renders KPI cards and chart sections", () => {
		render(<PlatformAnalyticsCharts data={createData()} />);

		expect(screen.getByText("Active users")).toBeTruthy();
		expect(screen.getByText("Signups")).toBeTruthy();
		expect(screen.getByText("Organizations")).toBeTruthy();
		expect(screen.getByText("Estimated MRR")).toBeTruthy();
		expect(screen.getByText("Growth")).toBeTruthy();
		expect(screen.getByText("Engagement")).toBeTruthy();
		expect(screen.getByText("Operations")).toBeTruthy();
		expect(screen.getByText("Commercial")).toBeTruthy();
	});

	it("hides commercial chart when billing is disabled", () => {
		render(<PlatformAnalyticsCharts data={createData({ billingEnabled: false })} />);

		expect(screen.queryByText("Commercial")).toBeNull();
		expect(screen.queryByText("Estimated MRR")).toBeNull();
	});

	it("shows empty states for empty series", () => {
		render(<PlatformAnalyticsCharts data={createData({ series: [] })} />);

		expect(screen.getAllByText("No data for this range").length).toBeGreaterThan(0);
	});
});

describe("PlatformAnalyticsPreviewCharts", () => {
	it("renders compact preview text", () => {
		render(<PlatformAnalyticsPreviewCharts data={createData()} />);

		expect(screen.getByText("Analytics trends")).toBeTruthy();
		expect(screen.getByText("View full analytics")).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test src/components/platform-admin/platform-analytics-charts.test.tsx`

Expected: FAIL because `platform-analytics-charts.tsx` does not exist.

- [ ] **Step 3: Implement client chart components**

Create `apps/webapp/src/components/platform-admin/platform-analytics-charts.tsx` with this content:

```tsx
"use client";

import { IconActivity, IconBuilding, IconClock, IconCreditCard, IconDatabase, IconUserPlus, IconUsers } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { Link } from "@/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { PlatformAnalyticsData, PlatformAnalyticsPoint } from "@/lib/platform-analytics/types";

const Area = dynamic(() => import("recharts").then((mod) => mod.Area), { ssr: false });
const AreaChart = dynamic(() => import("recharts").then((mod) => mod.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((mod) => mod.Bar), { ssr: false });
const BarChart = dynamic(() => import("recharts").then((mod) => mod.BarChart), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((mod) => mod.CartesianGrid), { ssr: false });
const Line = dynamic(() => import("recharts").then((mod) => mod.Line), { ssr: false });
const LineChart = dynamic(() => import("recharts").then((mod) => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((mod) => mod.YAxis), { ssr: false });

function formatNumber(value: number | null) {
	return value === null ? "Unavailable" : value.toLocaleString();
}

function formatCurrency(value: number | null) {
	return value === null ? "Unavailable" : `€${value.toLocaleString()}`;
}

function hasAnyData(data: PlatformAnalyticsPoint[], keys: Array<keyof PlatformAnalyticsPoint>) {
	return data.some((point) => keys.some((key) => Number(point[key] ?? 0) > 0));
}

function KpiCard({ title, value, description, icon }: { title: string; value: string; description: string; icon: React.ReactNode }) {
	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				<div className="text-muted-foreground">{icon}</div>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-bold tabular-nums">{value}</div>
				<p className="text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

function EmptyChart() {
	return <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">No data for this range</div>;
}

function GrowthChart({ data }: { data: PlatformAnalyticsPoint[] }) {
	if (!hasAnyData(data, ["signups", "organizations"])) {
		return <EmptyChart />;
	}

	return (
		<ChartContainer className="h-[260px]" config={{ signups: { label: "Signups", color: "hsl(var(--primary))" }, organizations: { label: "Organizations", color: "hsl(var(--chart-2))" } }}>
			<LineChart data={data} accessibilityLayer margin={{ left: 12, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis tickLine={false} axisLine={false} width={32} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Line dataKey="signups" stroke="var(--color-signups)" strokeWidth={2} dot={false} />
				<Line dataKey="organizations" stroke="var(--color-organizations)" strokeWidth={2} dot={false} />
			</LineChart>
		</ChartContainer>
	);
}

function EngagementChart({ data }: { data: PlatformAnalyticsPoint[] }) {
	if (!hasAnyData(data, ["activeUsers", "sessions"])) {
		return <EmptyChart />;
	}

	return (
		<ChartContainer className="h-[260px]" config={{ activeUsers: { label: "Active users", color: "hsl(var(--primary))" }, sessions: { label: "Sessions", color: "hsl(var(--chart-3))" } }}>
			<AreaChart data={data} accessibilityLayer margin={{ left: 12, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis tickLine={false} axisLine={false} width={32} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Area dataKey="sessions" fill="var(--color-sessions)" fillOpacity={0.16} stroke="var(--color-sessions)" />
				<Area dataKey="activeUsers" fill="var(--color-activeUsers)" fillOpacity={0.22} stroke="var(--color-activeUsers)" />
			</AreaChart>
		</ChartContainer>
	);
}

function OperationsChart({ data }: { data: PlatformAnalyticsPoint[] }) {
	if (!hasAnyData(data, ["timeRecords"])) {
		return <EmptyChart />;
	}

	return (
		<ChartContainer className="h-[260px]" config={{ timeRecords: { label: "Time records", color: "hsl(var(--chart-4))" } }}>
			<BarChart data={data} accessibilityLayer>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis tickLine={false} axisLine={false} width={32} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Bar dataKey="timeRecords" fill="var(--color-timeRecords)" radius={4} />
			</BarChart>
		</ChartContainer>
	);
}

function CommercialChart({ data }: { data: PlatformAnalyticsPoint[] }) {
	if (!hasAnyData(data, ["seats", "mrr"])) {
		return <EmptyChart />;
	}

	return (
		<ChartContainer className="h-[260px]" config={{ seats: { label: "Seats", color: "hsl(var(--chart-2))" }, mrr: { label: "Estimated MRR", color: "hsl(var(--chart-5))" } }}>
			<LineChart data={data} accessibilityLayer margin={{ left: 12, right: 12 }}>
				<CartesianGrid vertical={false} />
				<XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
				<YAxis tickLine={false} axisLine={false} width={32} />
				<ChartTooltip content={<ChartTooltipContent />} />
				<Line dataKey="seats" stroke="var(--color-seats)" strokeWidth={2} dot={false} />
				<Line dataKey="mrr" stroke="var(--color-mrr)" strokeWidth={2} dot={false} />
			</LineChart>
		</ChartContainer>
	);
}

export function PlatformAnalyticsCharts({ data }: { data: PlatformAnalyticsData }) {
	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<KpiCard title="Active users" value={formatNumber(data.kpis.activeUsers)} description="Users with sessions in the latest bucket" icon={<IconUsers className="size-4" aria-hidden="true" />} />
				<KpiCard title="Signups" value={formatNumber(data.kpis.signups)} description="New accounts in the latest bucket" icon={<IconUserPlus className="size-4" aria-hidden="true" />} />
				<KpiCard title="Organizations" value={formatNumber(data.kpis.organizations)} description="Current non-deleted organizations" icon={<IconBuilding className="size-4" aria-hidden="true" />} />
				<KpiCard title="Sessions" value={formatNumber(data.kpis.sessions)} description="Sessions created in the latest bucket" icon={<IconActivity className="size-4" aria-hidden="true" />} />
				<KpiCard title="Time records" value={formatNumber(data.kpis.timeRecords)} description="Records created in the latest bucket" icon={<IconClock className="size-4" aria-hidden="true" />} />
				{data.billingEnabled ? <KpiCard title="Seats" value={formatNumber(data.kpis.seats)} description="Current subscribed seats" icon={<IconCreditCard className="size-4" aria-hidden="true" />} /> : null}
				{data.billingEnabled ? <KpiCard title="Estimated MRR" value={formatCurrency(data.kpis.mrr)} description="Based on current billing logic" icon={<IconDatabase className="size-4" aria-hidden="true" />} /> : null}
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				<ChartCard title="Growth" description="Signups and organizations over the selected range"><GrowthChart data={data.series} /></ChartCard>
				<ChartCard title="Engagement" description="Active users and sessions over the selected range"><EngagementChart data={data.series} /></ChartCard>
				<ChartCard title="Operations" description="Time records created over the selected range"><OperationsChart data={data.series} /></ChartCard>
				{data.billingEnabled ? <ChartCard title="Commercial" description="Seats and estimated MRR over the selected range"><CommercialChart data={data.series} /></ChartCard> : null}
			</div>

			{data.billingEnabled && data.kpis.estimatedBilling ? <p className="text-xs text-muted-foreground">Historical seats and MRR are estimated from subscription and seat-audit data. Exact reconstruction requires future daily snapshots or a billing ledger.</p> : null}
		</div>
	);
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

export function PlatformAnalyticsPreviewCharts({ data }: { data: PlatformAnalyticsData }) {
	return (
		<Card>
			<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<CardTitle>Analytics trends</CardTitle>
					<CardDescription>Recent platform growth and engagement</CardDescription>
				</div>
				<Link href="/platform-admin/analytics" className="text-sm font-medium text-primary hover:underline">View full analytics</Link>
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-2">
				<div>
					<p className="mb-2 text-sm font-medium">Growth</p>
					<GrowthChart data={data.series} />
				</div>
				<div>
					<p className="mb-2 text-sm font-medium">Engagement</p>
					<EngagementChart data={data.series} />
				</div>
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter webapp test src/components/platform-admin/platform-analytics-charts.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit chart components**

```bash
git add apps/webapp/src/components/platform-admin/platform-analytics-charts.tsx apps/webapp/src/components/platform-admin/platform-analytics-charts.test.tsx
git commit -m "feat: add platform analytics chart components"
```

---

### Task 5: Full Analytics Route And Controls

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx`

- [ ] **Step 1: Add analytics controls**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx` with this content:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPlatformAnalyticsBucketOptions } from "@/lib/platform-analytics/range";
import type { PlatformAnalyticsBucket, PlatformAnalyticsRange } from "@/lib/platform-analytics/types";

const RANGE_OPTIONS: Array<{ value: PlatformAnalyticsRange; label: string }> = [
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
	{ value: "12m", label: "Last 12 months" },
];

const BUCKET_LABELS: Record<PlatformAnalyticsBucket, string> = {
	day: "Daily",
	week: "Weekly",
	month: "Monthly",
};

export function PlatformAnalyticsControls({ range, bucket }: { range: PlatformAnalyticsRange; bucket: PlatformAnalyticsBucket }) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const bucketOptions = getPlatformAnalyticsBucketOptions(range);

	function updateParam(key: "range" | "bucket", value: string) {
		const params = new URLSearchParams(searchParams.toString());
		params.set(key, value);

		if (key === "range") {
			const nextRange = value as PlatformAnalyticsRange;
			const allowedBuckets = getPlatformAnalyticsBucketOptions(nextRange);
			if (!allowedBuckets.includes(params.get("bucket") as PlatformAnalyticsBucket)) {
				params.set("bucket", allowedBuckets[0]);
			}
		}

		router.push(`/platform-admin/analytics?${params.toString()}`);
	}

	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
			<Select value={range} onValueChange={(value) => updateParam("range", value)}>
				<SelectTrigger className="w-full sm:w-[180px]" aria-label="Analytics range">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{RANGE_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
					))}
				</SelectContent>
			</Select>

			<Select value={bucket} onValueChange={(value) => updateParam("bucket", value)}>
				<SelectTrigger className="w-full sm:w-[160px]" aria-label="Analytics bucket">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{bucketOptions.map((option) => (
						<SelectItem key={option} value={option}>{BUCKET_LABELS[option]}</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
```

- [ ] **Step 2: Add the full analytics page**

Create `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx` with this content:

```tsx
import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformAnalyticsCharts } from "@/components/platform-admin/platform-analytics-charts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
import type { PlatformAnalyticsSearchParams } from "@/lib/platform-analytics/types";
import { getTranslate } from "@/tolgee/server";
import { PlatformAnalyticsControls } from "./analytics-controls";

type PlatformAnalyticsPageProps = {
	searchParams?: Promise<PlatformAnalyticsSearchParams>;
};

export default async function PlatformAnalyticsPage({ searchParams }: PlatformAnalyticsPageProps) {
	await connection();
	const [t, rawSearchParams] = await Promise.all([getTranslate(), searchParams ?? Promise.resolve({})]);
	const parsedParams = parsePlatformAnalyticsParams(rawSearchParams);

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">{t("admin:admin.analytics.title", "Platform Analytics")}</h1>
					<p className="text-muted-foreground">{t("admin:admin.analytics.description", "Track platform growth, engagement, operations, and billing trends.")}</p>
				</div>
				<PlatformAnalyticsControls range={parsedParams.range} bucket={parsedParams.bucket} />
			</div>

			<Suspense fallback={<PlatformAnalyticsLoading />}>
				<PlatformAnalyticsDataSection parsedParams={parsedParams} />
			</Suspense>
		</div>
	);
}

async function PlatformAnalyticsDataSection({ parsedParams }: { parsedParams: ReturnType<typeof parsePlatformAnalyticsParams> }) {
	const data = await getPlatformAnalyticsData(parsedParams);

	return <PlatformAnalyticsCharts data={data} />;
}

function PlatformAnalyticsLoading() {
	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				{Array.from({ length: 6 }).map((_, index) => (
					<Card key={index}>
						<CardHeader className="pb-2"><Skeleton className="h-4 w-28" /></CardHeader>
						<CardContent className="space-y-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-3 w-36" /></CardContent>
					</Card>
				))}
			</div>
			<div className="grid gap-4 xl:grid-cols-2">
				{Array.from({ length: 4 }).map((_, index) => (
					<Card key={index}>
						<CardHeader><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-48" /></CardHeader>
						<CardContent><Skeleton className="h-[260px] w-full" /></CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Run a targeted build check through tests**

Run: `pnpm --filter webapp test src/lib/platform-analytics/range.test.ts src/lib/platform-analytics/normalize.test.ts src/components/platform-admin/platform-analytics-charts.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit the analytics route**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx'
git commit -m "feat: add platform analytics dashboard route"
```

---

### Task 6: Overview Preview And Navigation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Update the platform-admin layout test**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts` by adding this test inside the existing `describe` block:

```ts
	it("links to the platform analytics page", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));

		expect(source).toContain('href: "/platform-admin/analytics"');
		expect(source).toContain('admin:admin.layout.nav.analytics');
	});
```

- [ ] **Step 2: Run the layout test to verify it fails**

Run: `pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'`

Expected: FAIL because the nav link does not exist yet.

- [ ] **Step 3: Add Analytics to platform admin navigation**

Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx`:

Add `IconChartLine` to the Tabler import list:

```ts
	IconChartLine,
```

Add this item immediately after the `/platform-admin` overview item in `navItems`:

```ts
		{
			href: "/platform-admin/analytics",
			icon: IconChartLine,
			label: t("admin:admin.layout.nav.analytics", "Analytics"),
		},
```

- [ ] **Step 4: Add compact analytics preview to overview page**

Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`:

Add these imports:

```ts
import { PlatformAnalyticsPreviewCharts } from "@/components/platform-admin/platform-analytics-charts";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";
```

Add this component above `AdminDashboardPage`:

```tsx
async function DashboardAnalyticsPreview() {
	await connection();

	const data = await getPlatformAnalyticsData(
		parsePlatformAnalyticsParams({ range: "30d", bucket: "week" }),
	);

	return <PlatformAnalyticsPreviewCharts data={data} />;
}

function DashboardAnalyticsPreviewLoading() {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-5 w-36" />
				<Skeleton className="h-4 w-56" />
			</CardHeader>
			<CardContent className="grid gap-4 lg:grid-cols-2">
				<Skeleton className="h-[260px] w-full" />
				<Skeleton className="h-[260px] w-full" />
			</CardContent>
		</Card>
	);
}
```

Add this section between the existing Metrics section and Quick Actions section:

```tsx
			<section className="space-y-4">
				<h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
					{t("admin:admin.overview.analytics.title", "Analytics Trends")}
				</h2>
				<Suspense fallback={<DashboardAnalyticsPreviewLoading />}>
					<DashboardAnalyticsPreview />
				</Suspense>
			</section>
```

- [ ] **Step 5: Run the layout test to verify it passes**

Run: `pnpm --filter webapp test 'src/app/[locale]/(admin)/platform-admin/layout.test.ts'`

Expected: PASS.

- [ ] **Step 6: Commit overview and navigation changes**

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/layout.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
git commit -m "feat: surface platform analytics in admin navigation"
```

---

### Task 7: Route Namespace Coverage

**Files:**
- Modify: `apps/webapp/src/tolgee/shared.ts`
- Modify: `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts`

- [ ] **Step 1: Add failing namespace test**

Modify `apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts` by adding this test:

```ts
	it("loads admin namespaces for /platform-admin/analytics", () => {
		expect(getNamespacesForRoute("/platform-admin/analytics")).toEqual(["common", "admin"]);
	});
```

- [ ] **Step 2: Run namespace tests**

Run: `pnpm --filter webapp test src/tolgee/__tests__/shared-route-namespaces.test.ts`

Expected: PASS if `/platform-admin` prefix already covers the analytics route. If it fails, continue to Step 3.

- [ ] **Step 3: Add explicit route mapping if needed**

If Step 2 fails, modify `apps/webapp/src/tolgee/shared.ts` by adding this route entry next to the existing `/platform-admin` entry:

```ts
	"/platform-admin/analytics": ["common", "admin"],
```

- [ ] **Step 4: Run namespace tests again**

Run: `pnpm --filter webapp test src/tolgee/__tests__/shared-route-namespaces.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit namespace coverage**

```bash
git add apps/webapp/src/tolgee/shared.ts apps/webapp/src/tolgee/__tests__/shared-route-namespaces.test.ts
git commit -m "test: cover platform analytics namespaces"
```

---

### Task 8: Verification And Cleanup

**Files:**
- Inspect changed files only.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter webapp test src/lib/platform-analytics/range.test.ts src/lib/platform-analytics/normalize.test.ts src/components/platform-admin/platform-analytics-charts.test.tsx 'src/app/[locale]/(admin)/platform-admin/layout.test.ts' src/tolgee/__tests__/shared-route-namespaces.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full webapp test suite**

Run: `pnpm --filter webapp test`

Expected: PASS.

- [ ] **Step 3: Run production build if environment allows it**

Run: `CI=true pnpm --filter webapp build`

Expected: PASS. If the build requires unavailable system-level environment variables, stop the build attempt and record the skipped variables in the final response.

- [ ] **Step 4: Inspect git diff**

Run: `git diff --stat && git diff --check`

Expected: `git diff --check` exits with no whitespace errors.

- [ ] **Step 5: Commit final verification fixes if any files changed**

If Step 1 through Step 4 required fixes, commit them:

```bash
git add apps/webapp/src/lib/platform-analytics apps/webapp/src/components/platform-admin 'apps/webapp/src/app/[locale]/(admin)' apps/webapp/src/tolgee
git commit -m "fix: harden platform analytics dashboard"
```

If no files changed after the previous task commits, skip this commit.

---

## Self-Review

Spec coverage:
- Compact `/platform-admin` preview: Task 6.
- Full `/platform-admin/analytics` page: Task 5.
- Postgres-only data layer: Task 3.
- Validated user-selectable range and bucket granularity: Task 1 and Task 5.
- Zero-filled chart buckets: Task 1 and Task 2.
- KPI cards and chart sections: Task 4 and Task 5.
- Billing-disabled behavior and estimated historical MRR note: Task 3 and Task 4.
- Platform-admin-only routing: Task 5 keeps the page inside the existing admin route group.
- Tests: Tasks 1, 2, 4, 6, 7, and 8.

Red-flag scan:
- The plan contains no unresolved work markers or fill-in markers.
- Each code-changing step contains exact code or exact import/item snippets.

Type consistency:
- `PlatformAnalyticsRange`, `PlatformAnalyticsBucket`, `ParsedPlatformAnalyticsParams`, `PlatformAnalyticsData`, and `PlatformAnalyticsPoint` are defined in Task 1 and reused consistently in later tasks.
- `getPlatformAnalyticsData`, `parsePlatformAnalyticsParams`, and `PlatformAnalyticsCharts` names match across service, route, and component tasks.
