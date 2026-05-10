import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildPlatformAnalyticsBuckets, parsePlatformAnalyticsParams } from "./range";
import { buildPlatformAnalyticsSeries, getLatestPointKpis } from "./normalize";

const NOW = DateTime.fromISO("2026-05-10T12:00:00Z", { zone: "utc" });

describe("buildPlatformAnalyticsSeries", () => {
	it("zero-fills missing metric buckets", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [{ bucket: "2026-05-04T00:00:00.000Z", value: 3 }],
				organizations: [{ bucket: "2026-05-05T00:00:00.000Z", value: "2" }],
				activeUsers: [],
				sessions: [],
				timeRecords: [],
				seats: [],
				mrr: [],
			},
			false,
		);

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
		const series = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [],
				organizations: [],
				activeUsers: [],
				sessions: [],
				timeRecords: [],
				seats: [{ bucket: "2026-05-10T00:00:00.000Z", value: 42 }],
				mrr: [{ bucket: "2026-05-10T00:00:00.000Z", value: 168 }],
			},
			true,
		);

		expect(series[6]).toMatchObject({ seats: 42, mrr: 168, estimatedBilling: true });
	});

	it("maps weekly aggregate rows by week bucket key", () => {
		const params = parsePlatformAnalyticsParams({ range: "30d", bucket: "week" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [],
				organizations: [],
				activeUsers: [{ bucket: "2026-04-25T00:00:00.000Z", value: 11 }],
				sessions: [],
				timeRecords: [],
				seats: [],
				mrr: [],
			},
			false,
		);

		expect(series.find((point) => point.bucketKey === "2026-04-25")).toMatchObject({ activeUsers: 11 });
		expect(series.find((point) => point.bucketKey === "2026-05-02")).toMatchObject({ activeUsers: 0 });
	});

	it("maps monthly aggregate rows by yyyy-MM bucket key", () => {
		const params = parsePlatformAnalyticsParams({ range: "12m", bucket: "month" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [],
				organizations: [{ bucket: "2026-05", value: 8 }],
				activeUsers: [],
				sessions: [],
				timeRecords: [],
				seats: [],
				mrr: [],
			},
			false,
		);

		expect(series.find((point) => point.bucketKey === "2026-05")).toMatchObject({ organizations: 8 });
		expect(series.find((point) => point.bucketKey === "2026-04")).toMatchObject({ organizations: 0 });
	});

	it("maps Date bucket input the same as the equivalent ISO string", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const isoSeries = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [{ bucket: "2026-05-08T00:00:00.000Z", value: 5 }],
				organizations: [],
				activeUsers: [],
				sessions: [],
				timeRecords: [],
				seats: [],
				mrr: [],
			},
			false,
		);
		const dateSeries = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [{ bucket: new Date("2026-05-08T00:00:00.000Z"), value: 5 }],
				organizations: [],
				activeUsers: [],
				sessions: [],
				timeRecords: [],
				seats: [],
				mrr: [],
			},
			false,
		);

		expect(dateSeries.find((point) => point.bucketKey === "2026-05-08")).toEqual(
			isoSeries.find((point) => point.bucketKey === "2026-05-08"),
		);
	});
});

describe("getLatestPointKpis", () => {
	it("uses latest point values plus supplied current totals", () => {
		const params = parsePlatformAnalyticsParams({ range: "7d", bucket: "day" }, NOW);
		const buckets = buildPlatformAnalyticsBuckets(params);
		const series = buildPlatformAnalyticsSeries(
			buckets,
			{
				signups: [{ bucket: "2026-05-10T00:00:00.000Z", value: 4 }],
				organizations: [],
				activeUsers: [{ bucket: "2026-05-10T00:00:00.000Z", value: 9 }],
				sessions: [{ bucket: "2026-05-10T00:00:00.000Z", value: 12 }],
				timeRecords: [{ bucket: "2026-05-10T00:00:00.000Z", value: 100 }],
				seats: [],
				mrr: [],
			},
			false,
		);

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
