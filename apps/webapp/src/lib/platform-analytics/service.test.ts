import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { groupByArgs, selectMock, executeMock } = vi.hoisted(() => ({
	groupByArgs: [] as unknown[],
	selectMock: vi.fn(),
	executeMock: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: selectMock,
		execute: executeMock,
	},
}));

import { getPlatformAnalyticsData } from "./service";

function queueSelectResult(rows: unknown[]) {
	selectMock.mockReturnValueOnce({
		from: () => ({
			where: () => ({
				groupBy: (...args: unknown[]) => {
					groupByArgs.push(...args);

					return Promise.resolve(rows);
				},
			}),
		}),
	});
}

function queueCurrentTotal(rows: unknown[]) {
	selectMock.mockReturnValueOnce({
		from: () => ({
			where: () => Promise.resolve(rows),
		}),
	});
}

describe("getPlatformAnalyticsData", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-10T12:00:00.000Z"));
		selectMock.mockReset();
		executeMock.mockReset();
		groupByArgs.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns aggregate platform analytics with billing disabled", async () => {
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 3 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 2 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 4 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 5 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 6 }]);
		queueCurrentTotal([{ value: 7 }]);
		queueCurrentTotal([{ value: 4 }]);

		const data = await getPlatformAnalyticsData({ range: "7d", bucket: "day" }, false);

		expect(data.billingEnabled).toBe(false);
		expect(data.params).toMatchObject({ range: "7d", bucket: "day" });
		expect(data.series).toHaveLength(7);
		expect(data.series.at(-1)).toMatchObject({
			signups: 3,
			organizations: 2,
			activeUsers: 4,
			sessions: 5,
			timeRecords: 6,
			seats: null,
			mrr: null,
			estimatedBilling: false,
		});
		expect(data.kpis).toEqual({
			activeUsers: 4,
			signups: 3,
			organizations: 7,
			seats: null,
			sessions: 5,
			timeRecords: 6,
			mrr: null,
			estimatedBilling: false,
		});
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("includes current and estimated billing analytics when billing is enabled", async () => {
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueCurrentTotal([{ value: 2 }]);
		queueCurrentTotal([{ value: 0 }]);
		queueCurrentTotal([{ seats: 9, mrr: 32 }]);
		executeMock.mockResolvedValueOnce([{ bucket: "2026-05-10T00:00:00.000Z", seats: 8, mrr: 28 }]);

		const data = await getPlatformAnalyticsData({ range: "7d", bucket: "day" }, true);

		expect(data.billingEnabled).toBe(true);
		expect(data.series.at(-1)).toMatchObject({ seats: 8, mrr: 28, estimatedBilling: true });
		expect(data.kpis).toMatchObject({
			organizations: 2,
			seats: 9,
			mrr: 32,
			estimatedBilling: true,
		});
		expect(executeMock).toHaveBeenCalledTimes(1);
	});

	it("skips billing and time-record work for lightweight previews", async () => {
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 3 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 2 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 4 }]);
		queueSelectResult([{ bucket: "2026-05-10T00:00:00.000Z", value: 5 }]);
		queueCurrentTotal([{ value: 7 }]);
		queueCurrentTotal([{ value: 4 }]);

		const data = await getPlatformAnalyticsData({ range: "7d", bucket: "day" }, true, {
			includeBilling: false,
			includeTimeRecords: false,
		});

		expect(data.billingEnabled).toBe(false);
		expect(data.series.at(-1)).toMatchObject({
			signups: 3,
			organizations: 2,
			activeUsers: 4,
			sessions: 5,
			timeRecords: 0,
			seats: null,
			mrr: null,
			estimatedBilling: false,
		});
		expect(data.kpis).toMatchObject({
			organizations: 7,
			timeRecords: 0,
			seats: null,
			mrr: null,
			estimatedBilling: false,
		});
		expect(selectMock).toHaveBeenCalledTimes(6);
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("uses current non-banned users for the active users KPI", async () => {
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueCurrentTotal([{ value: 7 }]);
		queueCurrentTotal([{ value: 3 }]);

		const data = await getPlatformAnalyticsData({ range: "7d", bucket: "day" }, false);

		expect(data.series.at(-1)).toMatchObject({ activeUsers: 0 });
		expect(data.kpis.activeUsers).toBe(3);
	});

	it("generates billing estimates through the final partial bucket in UTC", async () => {
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueCurrentTotal([{ value: 2 }]);
		queueCurrentTotal([{ value: 0 }]);
		queueCurrentTotal([{ seats: 9, mrr: 32 }]);
		executeMock.mockResolvedValueOnce([]);

		await getPlatformAnalyticsData({ range: "30d", bucket: "week" }, true);

		const generatedSql = getExecutedSqlText();

		expect(generatedSql).toContain("- '1 millisecond'::interval");
		expect(generatedSql).toContain("AT TIME ZONE 'UTC'");
	});

	it("groups aggregate queries by the selected bucket expression ordinal", async () => {
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueCurrentTotal([{ value: 0 }]);
		queueCurrentTotal([{ value: 0 }]);

		await getPlatformAnalyticsData({ range: "30d", bucket: "week" }, false, {
			includeTimeRecords: false,
		});

		const generatedSql = groupByArgs.map((arg) => collectStrings(arg, new WeakSet()).join(" "));

		expect(generatedSql).toEqual(["1", "1", "1", "1"]);
	});
});

function getExecutedSqlText() {
	return collectStrings(executeMock.mock.calls[0]?.[0] ?? {}, new WeakSet()).join(" ");
}

function collectStrings(value: unknown, seen: WeakSet<object>): string[] {
	if (typeof value === "string") {
		return [value];
	}

	if (!value || typeof value !== "object" || seen.has(value)) {
		return [];
	}

	seen.add(value);

	return Object.values(value).flatMap((child) => collectStrings(child, seen));
}
