import { DateTime } from "luxon";

import type {
	PlatformAnalyticsAggregateRow,
	PlatformAnalyticsBucketInfo,
	PlatformAnalyticsKpis,
	PlatformAnalyticsMetricKey,
	PlatformAnalyticsPoint,
} from "./types";

type PlatformAnalyticsRows = Record<PlatformAnalyticsMetricKey, PlatformAnalyticsAggregateRow[]>;
type CurrentPlatformAnalyticsTotals = Pick<
	PlatformAnalyticsKpis,
	"organizations" | "seats" | "mrr" | "estimatedBilling"
>;

export function buildPlatformAnalyticsSeries(
	buckets: PlatformAnalyticsBucketInfo[],
	rows: PlatformAnalyticsRows,
	estimatedBilling: boolean,
): PlatformAnalyticsPoint[] {
	const rowValues = Object.fromEntries(
		Object.entries(rows).map(([metric, metricRows]) => [metric, buildMetricValueMap(metricRows, buckets)]),
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
		activeUsers: latestPoint?.activeUsers ?? 0,
		signups: latestPoint?.signups ?? 0,
		organizations: currentTotals.organizations,
		seats: currentTotals.seats,
		sessions: latestPoint?.sessions ?? 0,
		timeRecords: latestPoint?.timeRecords ?? 0,
		mrr: currentTotals.mrr,
		estimatedBilling: currentTotals.estimatedBilling,
	};
}

function buildMetricValueMap(rows: PlatformAnalyticsAggregateRow[], buckets: PlatformAnalyticsBucketInfo[]) {
	const values = new Map<string, number>();

	for (const row of rows) {
		const key = findBucketKey(row.bucket, buckets);

		if (key) {
			values.set(key, normalizeValue(row.value));
		}
	}

	return values;
}

function findBucketKey(bucket: PlatformAnalyticsAggregateRow["bucket"], buckets: PlatformAnalyticsBucketInfo[]) {
	const date = bucket instanceof Date ? DateTime.fromJSDate(bucket, { zone: "utc" }) : DateTime.fromISO(bucket, { zone: "utc" });

	if (!date.isValid) {
		return null;
	}

	return buckets.find((candidate) => candidate.key === formatRowKey(date, candidate.key))?.key ?? null;
}

function formatRowKey(date: DateTime, bucketKey: string) {
	return bucketKey.length === 7 ? date.toFormat("yyyy-MM") : (date.toISODate() ?? "");
}

function normalizeValue(value: PlatformAnalyticsAggregateRow["value"]) {
	const numberValue = Number(value);

	return Number.isFinite(numberValue) ? numberValue : 0;
}

function getBillingValue(values: Map<string, number>, key: string) {
	return values.has(key) ? (values.get(key) ?? 0) : null;
}
