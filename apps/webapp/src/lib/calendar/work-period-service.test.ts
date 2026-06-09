import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkPeriodsForMonth, workPeriodOverlapsCalendarMonth } from "./work-period-service";

const source = readFileSync(
	fileURLToPath(new URL("./work-period-service.ts", import.meta.url)),
	"utf8",
);

const mockOperators = vi.hoisted(() => ({
	and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
	eq: vi.fn((column: unknown, value: unknown) => ({ column, type: "eq", value })),
	gte: vi.fn((column: unknown, value: unknown) => ({ column, type: "gte", value })),
	isNull: vi.fn((column: unknown) => ({ column, type: "isNull" })),
	lte: vi.fn((column: unknown, value: unknown) => ({ column, type: "lte", value })),
	not: vi.fn((condition: unknown) => ({ condition, type: "not" })),
	or: vi.fn((...conditions: unknown[]) => ({ conditions, type: "or" })),
}));

const mockDb = vi.hoisted(() => ({
	select: vi.fn(),
	from: vi.fn(),
	innerJoin: vi.fn(),
	leftJoin: vi.fn(),
	where: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: mockOperators.and,
	eq: mockOperators.eq,
	gte: mockOperators.gte,
	isNull: mockOperators.isNull,
	lte: mockOperators.lte,
	not: mockOperators.not,
	or: mockOperators.or,
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

	it("uses employee calendar timezone boundaries when querying month work periods", async () => {
		mockDb.where.mockResolvedValue([]);

		await getWorkPeriodsForMonth(
			4,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"America/New_York",
		);

		expect(mockOperators.gte).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-05-01T04:00:00.000Z"),
		);
		expect(mockOperators.lte).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-06-01T03:59:59.999Z"),
		);
	});

	it("excludes deleted work periods from calendar month reads", () => {
		const body = source.slice(
			source.indexOf("export async function getWorkPeriodsForMonth"),
			source.indexOf("/**\n * Aggregate work periods by day and employee"),
		);

		expect(body).toContain("isNull(workPeriod.deletedAt)");
	});

	it("includes employee id metadata when aggregating work period events", () => {
		const aggregateBody = source.slice(
			source.indexOf("function _aggregateByDay"),
			source.indexOf("/**\n * Format duration"),
		);

		expect(aggregateBody).toContain("employeeId: group.employeeId");
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
				clockInEntry: {
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
				},
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
				employeeId: "employee-1",
				employeeName: "Ada Lovelace",
				startTime: "8:00 AM",
				isRunning: true,
				projectId: "project-1",
				projectName: "Payroll",
				projectColor: "#2563eb",
				approvalStatus: "pending",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
			},
		});
		expect(events[0]?.metadata).not.toHaveProperty("endTime");
		expect(events[0]?.metadata).not.toHaveProperty("clockOutUtcOffsetMinutes");
		expect(events[0]?.metadata).not.toHaveProperty("clockOutTimezone");
		expect(events[0]?.metadata).not.toHaveProperty("surchargeMinutes");
		expect(events[0]?.metadata).not.toHaveProperty("totalCreditedMinutes");
		expect(events[0]?.metadata).not.toHaveProperty("surchargeBreakdown");
	});

	it("returns completed work period offset metadata from distinct clock entries", async () => {
		const startTime = new Date("2026-05-04T07:00:00.000Z");
		const endTime = new Date("2026-05-04T15:30:00.000Z");

		mockDb.where.mockResolvedValue([
			{
				period: {
					id: "period-2",
					organizationId: "org-1",
					employeeId: "employee-1",
					startTime,
					endTime,
					durationMinutes: 510,
					isActive: false,
					approvalStatus: "approved",
					projectId: null,
					clockInId: "clock-in-1",
					clockOutId: "clock-out-1",
				},
				employee: { id: "employee-1", userId: "user-1" },
				user: { id: "user-1", name: "Ada Lovelace" },
				clockInEntry: {
					id: "clock-in-1",
					utcOffsetMinutes: 60,
					timezone: "Europe/Berlin",
				},
				clockOutEntry: {
					id: "clock-out-1",
					utcOffsetMinutes: -300,
					timezone: "America/New_York",
					notes: " Wrapped up handoff ",
				},
				surcharge: null,
				project: null,
			},
		]);

		const events = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			id: "period-2",
			type: "work_period",
			date: startTime,
			endDate: endTime,
			title: "Ada Lovelace - 8h 30m: Wrapped up handoff",
			description: "Wrapped up handoff",
			metadata: {
				durationMinutes: 510,
				employeeId: "employee-1",
				employeeName: "Ada Lovelace",
				notes: "Wrapped up handoff",
				clockInUtcOffsetMinutes: 60,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: -300,
				clockOutTimezone: "America/New_York",
			},
		});
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
