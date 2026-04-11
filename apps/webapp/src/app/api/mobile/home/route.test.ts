import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireMobileSessionContext: vi.fn(),
	requireMobileEmployee: vi.fn(),
	getUserTimezone: vi.fn(),
	getActiveWorkPeriod: vi.fn(),
	getTimeSummary: vi.fn(),
	findLatestTimeEntry: vi.fn(),
	findNextApprovedAbsence: vi.fn(),
}));

vi.mock("@/app/api/mobile/shared", () => ({
	MobileApiError: class MobileApiError extends Error {
		constructor(
			readonly status: number,
			message: string,
		) {
			super(message);
		}
	},
	requireMobileSessionContext: mockState.requireMobileSessionContext,
	requireMobileEmployee: mockState.requireMobileEmployee,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getUserTimezone: mockState.getUserTimezone,
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/queries", () => ({
	getActiveWorkPeriod: mockState.getActiveWorkPeriod,
	getTimeSummary: mockState.getTimeSummary,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			timeEntry: {
				findFirst: mockState.findLatestTimeEntry,
			},
			absenceEntry: {
				findFirst: mockState.findNextApprovedAbsence,
			},
		},
	},
}));

const { GET } = await import("./route");

describe("GET /api/mobile/home", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the clock state, today summary, and next approved absence", async () => {
		mockState.requireMobileSessionContext.mockResolvedValue({
			session: {
				user: {
					id: "user-1",
				},
				session: {
					activeOrganizationId: "org-1",
				},
			},
			activeOrganizationId: "org-1",
			memberships: [{ organizationId: "org-1" }],
		});
		mockState.requireMobileEmployee.mockResolvedValue({
			id: "emp-1",
			organizationId: "org-1",
		});
		mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
		mockState.getActiveWorkPeriod.mockResolvedValue({
			id: "wp-1",
			startTime: new Date("2026-04-11T08:00:00.000Z"),
		});
		mockState.getTimeSummary.mockResolvedValue({
			todayMinutes: 135,
			weekMinutes: 600,
			monthMinutes: 2400,
		});
		mockState.findLatestTimeEntry.mockResolvedValue({
			type: "clock_out",
		});
		mockState.findNextApprovedAbsence.mockResolvedValue({
			id: "absence-1",
			startDate: "2026-04-14",
			endDate: "2026-04-15",
			startPeriod: "full_day",
			endPeriod: "full_day",
			category: {
				id: "category-1",
				name: "Vacation",
				color: "#22c55e",
			},
		});

		const response = await GET(new Request("https://app.example.com/api/mobile/home"));

		expect(response.status).toBe(200);
		expect(mockState.requireMobileEmployee).toHaveBeenCalledWith("user-1", "org-1");
		expect(mockState.getActiveWorkPeriod).toHaveBeenCalledWith("emp-1");
		expect(mockState.getTimeSummary).toHaveBeenCalledWith("emp-1", "Europe/Berlin");
		expect(await response.json()).toEqual({
			activeOrganizationId: "org-1",
			clock: {
				isClockedIn: true,
				activeWorkPeriod: {
					id: "wp-1",
					startTime: "2026-04-11T08:00:00.000Z",
				},
			},
			today: {
				minutesWorked: 135,
				latestEventLabel: "Clocked out",
				nextApprovedAbsence: {
					id: "absence-1",
					startDate: "2026-04-14",
					endDate: "2026-04-15",
					startPeriod: "full_day",
					endPeriod: "full_day",
					category: {
						id: "category-1",
						name: "Vacation",
						color: "#22c55e",
					},
				},
			},
		});
	});
});
