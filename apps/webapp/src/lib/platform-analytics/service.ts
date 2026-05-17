import { and, count, countDistinct, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { DateTime } from "luxon";

import { db } from "@/db";
import { organization, session, user } from "@/db/auth-schema";
import { billingSeatAudit, subscription, timeRecord } from "@/db/schema";

import { buildPlatformAnalyticsSeries, getLatestPointKpis } from "./normalize";
import { buildPlatformAnalyticsBuckets, parsePlatformAnalyticsParams } from "./range";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsAggregateRow,
	PlatformAnalyticsBucket,
	PlatformAnalyticsData,
	PlatformAnalyticsSearchParams,
} from "./types";

const BILLING_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

type PlatformAnalyticsDataOptions = {
	includeBilling?: boolean;
	includeTimeRecords?: boolean;
};

export async function getPlatformAnalyticsData(
	params: PlatformAnalyticsSearchParams,
	billingEnabled = process.env.BILLING_ENABLED === "true",
	options: PlatformAnalyticsDataOptions = {},
): Promise<PlatformAnalyticsData> {
	const includeBilling = options.includeBilling ?? true;
	const includeTimeRecords = options.includeTimeRecords ?? true;
	const effectiveBillingEnabled = billingEnabled && includeBilling;
	const parsedParams = parsePlatformAnalyticsParams(params);
	const buckets = buildPlatformAnalyticsBuckets(parsedParams);
	const [signups, organizations, activeUsers, sessions, timeRecords, currentOrganizations, billing] =
		await Promise.all([
			getSignupsByBucket(parsedParams),
			getOrganizationsByBucket(parsedParams),
			getActiveUsersByBucket(parsedParams),
			getSessionsByBucket(parsedParams),
			includeTimeRecords ? getTimeRecordsByBucket(parsedParams) : Promise.resolve([]),
			getCurrentOrganizations(),
			effectiveBillingEnabled ? getBillingAnalytics(parsedParams) : Promise.resolve(null),
		]);

	const series = buildPlatformAnalyticsSeries(
		buckets,
		{
			signups,
			organizations,
			activeUsers,
			sessions,
			timeRecords,
			seats: billing?.seats ?? [],
			mrr: billing?.mrr ?? [],
		},
		effectiveBillingEnabled,
	);

	return {
		params: parsedParams,
		billingEnabled: effectiveBillingEnabled,
		series,
		kpis: getLatestPointKpis(series, {
			organizations: currentOrganizations,
			seats: billing?.currentSeats ?? null,
			mrr: billing?.currentMrr ?? null,
			estimatedBilling: effectiveBillingEnabled,
		}),
	};
}

function getSignupsByBucket(params: ParsedPlatformAnalyticsParams) {
	return getCountByBucket(user.createdAt, params);
}

function getOrganizationsByBucket(params: ParsedPlatformAnalyticsParams) {
	return getCountByBucket(organization.createdAt, params);
}

function getSessionsByBucket(params: ParsedPlatformAnalyticsParams) {
	return getCountByBucket(session.createdAt, params);
}

function getTimeRecordsByBucket(params: ParsedPlatformAnalyticsParams) {
	return getCountByBucket(timeRecord.createdAt, params);
}

function getActiveUsersByBucket(params: ParsedPlatformAnalyticsParams) {
	const bucket = getBucketSql(session.createdAt, params);

	return db
		.select({ bucket, value: countDistinct(session.userId) })
		.from(session)
		.where(and(gte(session.createdAt, toDate(params.startIso)), lt(session.createdAt, toDate(params.endIso))))
		.groupBy(sql`1`);
}

function getCountByBucket(column: AnyPgColumn, params: ParsedPlatformAnalyticsParams) {
	const bucket = getBucketSql(column, params);

	return db
		.select({ bucket, value: count() })
		.from(column.table)
		.where(and(gte(column, toDate(params.startIso)), lt(column, toDate(params.endIso))))
		.groupBy(sql`1`);
}

async function getCurrentOrganizations() {
	const [row] = await db
		.select({ value: count() })
		.from(organization)
		.where(isNull(organization.deletedAt));

	return Number(row?.value ?? 0);
}

async function getBillingAnalytics(params: ParsedPlatformAnalyticsParams) {
	const [currentTotals, estimatedRows] = await Promise.all([getCurrentBillingTotals(), getEstimatedBillingRows(params)]);

	return {
		currentSeats: currentTotals.seats,
		currentMrr: currentTotals.mrr,
		seats: estimatedRows.map((row) => ({ bucket: row.bucket, value: row.seats })),
		mrr: estimatedRows.map((row) => ({ bucket: row.bucket, value: row.mrr })),
	};
}

async function getCurrentBillingTotals() {
	const [row] = await db
		.select({
			seats: sql<number>`coalesce(sum(${subscription.currentSeats}), 0)`,
			mrr: sql<number>`coalesce(sum(${subscription.currentSeats} * case when ${subscription.billingInterval} = 'year' then 3 else 4 end), 0)`,
		})
		.from(subscription)
		.where(inArray(subscription.status, BILLING_SUBSCRIPTION_STATUSES));

	return {
		seats: Number(row?.seats ?? 0),
		mrr: Number(row?.mrr ?? 0),
	};
}

async function getEstimatedBillingRows(params: ParsedPlatformAnalyticsParams) {
	const rows = await db.execute<EstimatedBillingRow>(sql`
		with buckets as (
			select generate_series(
				${toDate(params.startIso)}::timestamptz AT TIME ZONE 'UTC',
				${toDate(params.endIso)}::timestamptz AT TIME ZONE 'UTC' - '1 millisecond'::interval,
				${getIntervalSql(params.bucket)}
			) as bucket
		)
		select
			buckets.bucket AT TIME ZONE 'UTC' as bucket,
			coalesce(sum(coalesce(latest_audit.new_seats, ${subscription.currentSeats})), 0)::int as seats,
			coalesce(sum(coalesce(latest_audit.new_seats, ${subscription.currentSeats}) * case when ${subscription.billingInterval} = 'year' then 3 else 4 end), 0)::int as mrr
		from buckets
		left join ${subscription}
			on ${subscription.status} in ('active', 'trialing', 'past_due')
			and ${subscription.createdAt} < (buckets.bucket + ${getIntervalSql(params.bucket)}) AT TIME ZONE 'UTC'
		left join lateral (
			select ${billingSeatAudit.newSeats} as new_seats
			from ${billingSeatAudit}
			where ${billingSeatAudit.organizationId} = ${subscription.organizationId}
				and ${billingSeatAudit.createdAt} < (buckets.bucket + ${getIntervalSql(params.bucket)}) AT TIME ZONE 'UTC'
			order by ${billingSeatAudit.createdAt} desc
			limit 1
		) latest_audit on true
		group by buckets.bucket
		order by buckets.bucket
	`);

	return getRows(rows).map((row) => ({
		bucket: row.bucket,
		seats: Number(row.seats ?? 0),
		mrr: Number(row.mrr ?? 0),
	}));
}

function getBucketSql(column: AnyPgColumn, params: ParsedPlatformAnalyticsParams): SQL<Date> {
	if (params.bucket === "week") {
		return sql<Date>`date_bin('7 days'::interval, ${column}, ${toDate(params.startIso)}::timestamp)`;
	}

	// These source columns are timestamp without time zone, stored and ranged as UTC instants.
	return sql<Date>`date_trunc(${params.bucket}, ${column})`;
}

function getIntervalSql(bucket: PlatformAnalyticsBucket) {
	switch (bucket) {
		case "day":
			return sql.raw("'1 day'::interval");
		case "week":
			return sql.raw("'7 days'::interval");
		case "month":
			return sql.raw("'1 month'::interval");
	}
}

function getRows<T>(rows: T[] | { rows: T[] }) {
	return Array.isArray(rows) ? rows : rows.rows;
}

function toDate(value: string) {
	return DateTime.fromISO(value, { zone: "utc" }).toJSDate();
}

type EstimatedBillingRow = PlatformAnalyticsAggregateRow & {
	seats: number | string | null;
	mrr: number | string | null;
};
