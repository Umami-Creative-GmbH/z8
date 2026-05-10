import { DateTime } from "luxon";

import {
	PLATFORM_ANALYTICS_BUCKETS,
	PLATFORM_ANALYTICS_RANGES,
	type ParsedPlatformAnalyticsParams,
	type PlatformAnalyticsBucket,
	type PlatformAnalyticsBucketInfo,
	type PlatformAnalyticsRange,
	type PlatformAnalyticsSearchParams,
} from "./types";

const DEFAULT_RANGE: PlatformAnalyticsRange = "30d";

const DEFAULT_BUCKET_BY_RANGE: Record<PlatformAnalyticsRange, PlatformAnalyticsBucket> = {
	"7d": "day",
	"30d": "day",
	"90d": "week",
	"12m": "month",
};

const BUCKET_OPTIONS_BY_RANGE: Record<PlatformAnalyticsRange, PlatformAnalyticsBucket[]> = {
	"7d": ["day"],
	"30d": ["day", "week"],
	"90d": ["day", "week", "month"],
	"12m": ["week", "month"],
};

export function parsePlatformAnalyticsParams(
	searchParams: PlatformAnalyticsSearchParams,
	now = DateTime.utc(),
): ParsedPlatformAnalyticsParams {
	const range = parseRange(firstValue(searchParams.range));
	const bucket = parseBucket(firstValue(searchParams.bucket), range);
	const today = now.toUTC().startOf("day");
	const rangeStart = getRangeStart(range, today);
	const start = bucket === "month" ? rangeStart.startOf("month") : rangeStart;
	const end = today.plus({ days: 1 });

	return {
		range,
		bucket,
		startIso: toIso(start),
		endIso: toIso(end),
	};
}

export function getPlatformAnalyticsBucketOptions(range: PlatformAnalyticsRange) {
	return BUCKET_OPTIONS_BY_RANGE[range];
}

export function buildPlatformAnalyticsBuckets(
	params: ParsedPlatformAnalyticsParams,
): PlatformAnalyticsBucketInfo[] {
	const end = DateTime.fromISO(params.endIso, { zone: "utc" });
	const buckets: PlatformAnalyticsBucketInfo[] = [];
	let start = DateTime.fromISO(params.startIso, { zone: "utc" });

	while (start < end) {
		const next = getNextBucketStart(start, params.bucket);
		const bucketEnd = next < end ? next : end;

		buckets.push({
			key: formatBucketKey(start, params.bucket),
			label: formatBucketLabel(start, params.bucket),
			startIso: toIso(start),
			endIso: toIso(bucketEnd),
		});

		start = next;
	}

	return buckets;
}

function firstValue(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function parseRange(value: string | undefined): PlatformAnalyticsRange {
	return PLATFORM_ANALYTICS_RANGES.includes(value as PlatformAnalyticsRange)
		? (value as PlatformAnalyticsRange)
		: DEFAULT_RANGE;
}

function parseBucket(value: string | undefined, range: PlatformAnalyticsRange): PlatformAnalyticsBucket {
	const bucket = PLATFORM_ANALYTICS_BUCKETS.includes(value as PlatformAnalyticsBucket)
		? (value as PlatformAnalyticsBucket)
		: undefined;

	if (bucket && BUCKET_OPTIONS_BY_RANGE[range].includes(bucket)) {
		return bucket;
	}

	return DEFAULT_BUCKET_BY_RANGE[range];
}

function getRangeStart(range: PlatformAnalyticsRange, today: DateTime) {
	switch (range) {
		case "7d":
			return today.minus({ days: 6 });
		case "30d":
			return today.minus({ days: 29 });
		case "90d":
			return today.minus({ days: 89 });
		case "12m":
			return today.startOf("month").minus({ months: 11 });
	}
}

function getNextBucketStart(start: DateTime, bucket: PlatformAnalyticsBucket) {
	switch (bucket) {
		case "day":
			return start.plus({ days: 1 });
		case "week":
			return start.plus({ weeks: 1 });
		case "month":
			return start.plus({ months: 1 });
	}
}

function formatBucketKey(start: DateTime, bucket: PlatformAnalyticsBucket) {
	return bucket === "month" ? start.toFormat("yyyy-MM") : (start.toISODate() ?? "");
}

function formatBucketLabel(start: DateTime, bucket: PlatformAnalyticsBucket) {
	return bucket === "month" ? start.toFormat("LLL yyyy") : start.toFormat("LLL d");
}

function toIso(value: DateTime) {
	return value.toUTC().toISO() ?? "";
}
