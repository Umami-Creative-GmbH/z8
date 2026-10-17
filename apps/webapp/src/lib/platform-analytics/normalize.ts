import { Temporal } from "temporal-polyfill";

import { instantFromDate, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type {
	PlatformAnalyticsAggregateRow,
	PlatformAnalyticsBucketInfo,
	PlatformAnalyticsKpis,
	PlatformAnalyticsMetricKey,
	PlatformAnalyticsPoint,
} from "./types";

// Bucket keys are UTC calendar dates, matching range.ts and the SQL bucketing.
const BUCKET_TIME_ZONE = "UTC";

type PlatformAnalyticsRows = Record<PlatformAnalyticsMetricKey, PlatformAnalyticsAggregateRow[]>;
type CurrentPlatformAnalyticsTotals = Pick<
	PlatformAnalyticsKpis,
	"activeUsers" | "organizations" | "seats" | "mrr" | "estimatedBilling"
>;

export function buildPlatformAnalyticsSeries(
	buckets: PlatformAnalyticsBucketInfo[],
	rows: PlatformAnalyticsRows,
	estimatedBilling: boolean,
): PlatformAnalyticsPoint[] {
	const rowValues = Object.fromEntries(
		Object.entries(rows).map(([metric, metricRows]) => [
			metric,
			buildMetricValueMap(metricRows, buckets),
		]),
	) as Record<PlatformAnalyticsMetricKey, Map<string, number>>;

	return buckets.map((bucket) => ({
		bucketKey: bucket.key,
		label: bucket.label,
		signups: rowValues.signups.get(bucket.key) ?? 0,
		organizations: rowValues.organizations.get(bucket.key) ?? 0,
		activeUsers: rowValues.activeUsers.get(bucket.key) ?? 0,
		sessions: rowValues.sessions.get(bucket.key) ?? 0,
		timeRecords: rowValues.timeRecords.get(bucket.key) ?? 0,
		seats: getBillingValue(rowValues.seats, bucket.key),
		mrr: getBillingValue(rowValues.mrr, bucket.key),
		estimatedBilling,
	}));
}

export function getLatestPointKpis(
	series: PlatformAnalyticsPoint[],
	currentTotals: CurrentPlatformAnalyticsTotals,
): PlatformAnalyticsKpis {
	const latestPoint = series.at(-1);

	return {
		activeUsers: currentTotals.activeUsers,
		signups: latestPoint?.signups ?? 0,
		organizations: currentTotals.organizations,
		seats: currentTotals.seats,
		sessions: latestPoint?.sessions ?? 0,
		timeRecords: latestPoint?.timeRecords ?? 0,
		mrr: currentTotals.mrr,
		estimatedBilling: currentTotals.estimatedBilling,
	};
}

function buildMetricValueMap(
	rows: PlatformAnalyticsAggregateRow[],
	buckets: PlatformAnalyticsBucketInfo[],
) {
	const values = new Map<string, number>();

	for (const row of rows) {
		const key = findBucketKey(row.bucket, buckets);

		if (key) {
			values.set(key, normalizeValue(row.value));
		}
	}

	return values;
}

function findBucketKey(
	bucket: PlatformAnalyticsAggregateRow["bucket"],
	buckets: PlatformAnalyticsBucketInfo[],
) {
	const date = parseBucketDate(bucket);

	if (!date) {
		return null;
	}

	return (
		buckets.find((candidate) => candidate.key === formatRowKey(date, candidate.key))?.key ?? null
	);
}

/**
 * The UTC calendar date a bucket row starts on. node-postgres hands raw `sql`
 * selections back as Postgres text: `2026-10-16 00:00:00` for `timestamp`
 * (UTC wall time) and `2026-10-16 00:00:00+00` for `timestamptz`.
 */
function parseBucketDate(bucket: PlatformAnalyticsAggregateRow["bucket"]): PlainDate | null {
	if (bucket instanceof Date) {
		return Number.isFinite(bucket.getTime())
			? plainDateAt(instantFromDate(bucket), BUCKET_TIME_ZONE)
			: null;
	}

	try {
		return plainDateAt(Temporal.Instant.from(bucket), BUCKET_TIME_ZONE);
	} catch {
		// No offset: the source columns store UTC wall time.
	}

	try {
		return Temporal.PlainDateTime.from(bucket).toPlainDate();
	} catch {
		// Not a date-time; may be a bare year-month.
	}

	try {
		return Temporal.PlainYearMonth.from(bucket).toPlainDate({ day: 1 });
	} catch {
		return null;
	}
}

function formatRowKey(date: PlainDate, bucketKey: string) {
	return bucketKey.length === 7 ? date.toPlainYearMonth().toString() : date.toString();
}

function normalizeValue(value: PlatformAnalyticsAggregateRow["value"]) {
	const numberValue = Number(value);

	return Number.isFinite(numberValue) ? numberValue : 0;
}

function getBillingValue(values: Map<string, number>, key: string) {
	return values.has(key) ? (values.get(key) ?? 0) : null;
}
