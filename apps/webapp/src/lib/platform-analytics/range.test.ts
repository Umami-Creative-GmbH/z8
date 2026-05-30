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
		expect(parsePlatformAnalyticsParams({ range: "90d", bucket: "month" }, NOW)).toMatchObject({
			range: "90d",
			bucket: "month",
		});
		expect(parsePlatformAnalyticsParams({ range: "12m", bucket: "month" }, NOW)).toMatchObject({
			range: "12m",
			bucket: "month",
		});
	});

	it("aligns monthly ranges to the containing month boundary", () => {
		expect(parsePlatformAnalyticsParams({ range: "90d", bucket: "month" }, NOW).startIso).toBe(
			"2026-02-01T00:00:00.000Z",
		);
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

	it("builds monthly buckets from month boundaries for ninety day ranges", () => {
		const params = parsePlatformAnalyticsParams({ range: "90d", bucket: "month" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);

		expect(buckets[0]).toMatchObject({
			key: "2026-02",
			startIso: "2026-02-01T00:00:00.000Z",
		});
		expect(buckets.map((bucket) => bucket.key)).toEqual([
			"2026-02",
			"2026-03",
			"2026-04",
			"2026-05",
		]);
	});
});
