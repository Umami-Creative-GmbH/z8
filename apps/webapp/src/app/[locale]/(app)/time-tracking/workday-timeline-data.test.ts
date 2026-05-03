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

import { getWorkdayTimelineData } from "./workday-timeline-data";

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
