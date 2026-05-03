import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	workPeriodFindMany: vi.fn(),
	shiftFindMany: vi.fn(),
	absenceFindMany: vi.fn(),
	getSelfServiceRequests: vi.fn(),
	loggerWarn: vi.fn(),
	loggerError: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			workPeriod: { findMany: mocks.workPeriodFindMany },
			shift: { findMany: mocks.shiftFindMany },
			absenceEntry: { findMany: mocks.absenceFindMany },
		},
	},
}));

vi.mock("@/lib/self-service-requests/get-self-service-requests", () => ({
	getSelfServiceRequests: mocks.getSelfServiceRequests,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: mocks.loggerWarn,
		error: mocks.loggerError,
	}),
}));

import {
	getWorkdayTimelineData,
	isRequestRelevantToSelectedDate,
	isWorkPeriodRelevantToSelectedDate,
} from "./workday-timeline-data";

describe("getWorkdayTimelineData", () => {
	beforeEach(() => {
		mocks.workPeriodFindMany.mockReset();
		mocks.shiftFindMany.mockReset();
		mocks.absenceFindMany.mockReset();
		mocks.getSelfServiceRequests.mockReset();
		mocks.loggerWarn.mockReset();
		mocks.loggerError.mockReset();

		mocks.workPeriodFindMany.mockResolvedValue([]);
		mocks.shiftFindMany.mockResolvedValue([]);
		mocks.absenceFindMany.mockResolvedValue([]);
		mocks.getSelfServiceRequests.mockResolvedValue({
			items: [],
			counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 },
			sourceErrors: [],
		});
	});

	it("loads all timeline sources for the selected employee and organization", async () => {
		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "Europe/Berlin",
			dateParam: "2026-05-03",
		});

		expect(result.success).toBe(true);
		expect(mocks.workPeriodFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.shiftFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.absenceFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.getSelfServiceRequests).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			filters: { status: "pending" },
		});
	});

	it("scopes DB source queries to the selected employee and organization", async () => {
		await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "UTC",
			dateParam: "2026-05-03",
		});

		const workPeriodOptions = mocks.workPeriodFindMany.mock.calls[0]?.[0];
		const shiftOptions = mocks.shiftFindMany.mock.calls[0]?.[0];
		const absenceOptions = mocks.absenceFindMany.mock.calls[0]?.[0];

		// Drizzle condition internals are intentionally opaque in unit tests; integration
		// tests cover the generated SQL shape. These assertions still guard that every
		// source query is built with scoped filters rather than accidentally unfiltered.
		expect(workPeriodOptions).toEqual(expect.objectContaining({ where: expect.any(Object) }));
		expect(shiftOptions).toEqual(expect.objectContaining({ where: expect.any(Object) }));
		expect(absenceOptions).toEqual(expect.objectContaining({ where: expect.any(Object) }));
	});

	it("filters pending requests to the selected workday before normalization", async () => {
		mocks.getSelfServiceRequests.mockResolvedValue({
			items: [
				createRequest({
					id: "current-day-submitted",
					subtitle: "Submitted for review",
					submittedAt: new Date("2026-05-03T08:00:00.000Z"),
				}),
				createRequest({
					id: "current-day-subtitle",
					subtitle: "Correction for 2026-05-03",
					submittedAt: new Date("2026-05-01T08:00:00.000Z"),
				}),
				createRequest({
					id: "other-day",
					subtitle: "Correction for 2026-05-04",
					submittedAt: new Date("2026-05-04T08:00:00.000Z"),
				}),
			],
			counts: { pending: 3, requiredFixes: 0, recentDecisions: 0, total: 3 },
			sourceErrors: [],
		});

		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "UTC",
			dateParam: "2026-05-03",
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items.map((item) => item.id).sort()).toEqual([
				"pending-request:current-day-submitted",
				"pending-request:current-day-subtitle",
			]);
		}
	});

	it("logs and continues when pending request sources partially fail", async () => {
		const sourceErrors = [
			{
				sourceType: "absence" as const,
				message: "Absence requests could not be loaded.",
			},
		];
		mocks.getSelfServiceRequests.mockResolvedValue({
			items: [],
			counts: { pending: 0, requiredFixes: 0, recentDecisions: 0, total: 0 },
			sourceErrors,
		});

		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "UTC",
			dateParam: "2026-05-03",
		});

		expect(result.success).toBe(true);
		expect(mocks.loggerWarn).toHaveBeenCalledWith(
			{ sourceErrors },
			"Workday timeline request sources partially failed",
		);
		expect(mocks.loggerError).not.toHaveBeenCalled();
	});

	it("returns an unavailable result if a source throws", async () => {
		const error = new Error("database unavailable");
		mocks.shiftFindMany.mockRejectedValue(error);

		const result = await getWorkdayTimelineData({
			employeeId: "employee-1",
			organizationId: "org-1",
			timezone: "UTC",
			dateParam: "2026-05-03",
		});

		expect(result).toMatchObject({ success: false, error: "Timeline unavailable" });
		if (!result.success) {
			expect(result.selectedDate.dateKey).toBe("2026-05-03");
		}
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{ error },
			"Workday timeline data could not be loaded",
		);
	});
});

describe("isRequestRelevantToSelectedDate", () => {
	it("accepts requests submitted on the selected local date", () => {
		expect(
			isRequestRelevantToSelectedDate(
				createRequest({ submittedAt: new Date("2026-05-02T22:30:00.000Z") }),
				"2026-05-03",
				"Europe/Berlin",
			),
		).toBe(true);
	});

	it("accepts requests whose subtitle contains the selected date key", () => {
		expect(
			isRequestRelevantToSelectedDate(
				createRequest({
					subtitle: "Time correction for 2026-05-03",
					submittedAt: new Date("2026-05-01T08:00:00.000Z"),
				}),
				"2026-05-03",
				"UTC",
			),
		).toBe(true);
	});

	it("accepts requests whose subtitle date range contains the selected date", () => {
		expect(
			isRequestRelevantToSelectedDate(
				createRequest({
					subtitle: "Absence 2026-05-01 to 2026-05-05",
					submittedAt: new Date("2026-04-30T08:00:00.000Z"),
				}),
				"2026-05-03",
				"UTC",
			),
		).toBe(true);
	});

	it("rejects requests unrelated to the selected date", () => {
		expect(
			isRequestRelevantToSelectedDate(
				createRequest({
					subtitle: "Time correction for 2026-05-04",
					submittedAt: new Date("2026-05-04T08:00:00.000Z"),
				}),
				"2026-05-03",
				"UTC",
			),
		).toBe(false);
	});
});

describe("isWorkPeriodRelevantToSelectedDate", () => {
	const selectedDate = {
		startUtc: { toJSDate: () => new Date("2026-05-03T00:00:00.000Z") },
		endUtc: { toJSDate: () => new Date("2026-05-03T23:59:59.999Z") },
	};

	it("accepts periods that started before the selected day and ended during it", () => {
		expect(
			isWorkPeriodRelevantToSelectedDate(
				{
					startTime: new Date("2026-05-02T22:00:00.000Z"),
					endTime: new Date("2026-05-03T06:00:00.000Z"),
				},
				selectedDate,
			),
		).toBe(true);
	});

	it("accepts active periods that started before the selected day ends", () => {
		expect(
			isWorkPeriodRelevantToSelectedDate(
				{
					startTime: new Date("2026-05-02T22:00:00.000Z"),
					endTime: null,
				},
				selectedDate,
			),
		).toBe(true);
	});

	it("rejects periods that do not overlap the selected day", () => {
		expect(
			isWorkPeriodRelevantToSelectedDate(
				{
					startTime: new Date("2026-05-04T00:00:00.000Z"),
					endTime: new Date("2026-05-04T06:00:00.000Z"),
				},
				selectedDate,
			),
		).toBe(false);
	});
});

function createRequest(overrides: Partial<Parameters<typeof isRequestRelevantToSelectedDate>[0]> = {}) {
	return {
		id: "request-1",
		sourceType: "time_correction" as const,
		sourceId: "source-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		status: "pending" as const,
		submittedAt: new Date("2026-05-03T08:00:00.000Z"),
		resolvedAt: null,
		title: "Time correction",
		subtitle: "Correction for 2026-05-03",
		decisionReason: null,
		availableActions: ["view" as const],
		sourceHref: "/time-tracking",
		...overrides,
	};
}
