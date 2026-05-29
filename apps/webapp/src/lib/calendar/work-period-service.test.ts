import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkPeriodsForMonth, workPeriodOverlapsCalendarMonth } from "./work-period-service";

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	from: vi.fn(),
	innerJoin: vi.fn(),
	leftJoin: vi.fn(),
	where: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockDb.select,
	},
}));

describe("getWorkPeriodsForMonth", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T10:30:00.000Z"));

		mockDb.select.mockReturnValue({ from: mockDb.from });
		mockDb.from.mockReturnValue({ innerJoin: mockDb.innerJoin });
		mockDb.innerJoin.mockReturnValue({
			innerJoin: mockDb.innerJoin,
			leftJoin: mockDb.leftJoin,
		});
		mockDb.leftJoin.mockReturnValue({ leftJoin: mockDb.leftJoin, where: mockDb.where });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("returns an active work period as a running calendar event ending now", async () => {
		const startTime = new Date("2026-05-04T08:00:00.000Z");
		const now = new Date("2026-05-04T10:30:00.000Z");

		mockDb.where.mockResolvedValue([
			{
				period: {
					id: "period-1",
					organizationId: "org-1",
					employeeId: "employee-1",
					startTime,
					endTime: null,
					durationMinutes: null,
					isActive: true,
					approvalStatus: "pending",
					projectId: "project-1",
					clockOutId: null,
				},
				employee: { id: "employee-1", userId: "user-1" },
				user: { id: "user-1", name: "Ada Lovelace" },
				clockOutEntry: null,
				surcharge: {
					surchargeMinutes: 45,
					calculationDetails: {
						rulesApplied: [
							{
								ruleName: "Night",
								ruleType: "time_window",
								percentage: 25,
								qualifyingMinutes: 60,
								surchargeMinutes: 15,
							},
						],
					},
				},
				project: { id: "project-1", name: "Payroll", color: "#2563eb" },
			},
		]);

		const events = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			id: "period-1",
			type: "work_period",
			date: startTime,
			endDate: now,
			title: "[Payroll] Ada Lovelace - 2h 30m (running)",
			description: "Running work period",
			descriptionKey: "calendar.calendar.workPeriod.runningDescription",
			color: "#2563eb",
			metadata: {
				durationMinutes: 150,
				employeeName: "Ada Lovelace",
				startTime: "8:00 AM",
				isRunning: true,
				projectId: "project-1",
				projectName: "Payroll",
				projectColor: "#2563eb",
				approvalStatus: "pending",
			},
		});
		expect(events[0]?.metadata).not.toHaveProperty("endTime");
		expect(events[0]?.metadata).not.toHaveProperty("surchargeMinutes");
		expect(events[0]?.metadata).not.toHaveProperty("totalCreditedMinutes");
		expect(events[0]?.metadata).not.toHaveProperty("surchargeBreakdown");
	});
});

describe("workPeriodOverlapsCalendarMonth", () => {
	const monthStart = new Date("2026-05-01T00:00:00.000Z");
	const monthEnd = new Date("2026-05-31T23:59:59.999Z");
	const now = new Date("2026-05-04T10:30:00.000Z");

	it("includes active running periods that started before the month and overlap now", () => {
		expect(
			workPeriodOverlapsCalendarMonth(
				{
					startTime: new Date("2026-04-30T20:00:00.000Z"),
					endTime: null,
					isActive: true,
				},
				monthStart,
				monthEnd,
				now,
			),
		).toBe(true);
	});

	it("keeps completed periods constrained to starts within the month", () => {
		expect(
			workPeriodOverlapsCalendarMonth(
				{
					startTime: new Date("2026-04-30T20:00:00.000Z"),
					endTime: new Date("2026-05-01T02:00:00.000Z"),
					isActive: false,
				},
				monthStart,
				monthEnd,
				now,
			),
		).toBe(false);
	});
});
