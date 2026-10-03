import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automaticClockOutExecution, workPeriod } from "@/db/schema";
import { getWorkPeriodsForMonth, workPeriodOverlapsCalendarMonth } from "./work-period-service";

const mockOperators = vi.hoisted(() => ({
	and: vi.fn((...conditions: unknown[]) => ({ conditions, type: "and" })),
	eq: vi.fn((column: unknown, value: unknown) => ({
		column,
		type: "eq",
		value,
	})),
	gt: vi.fn((column: unknown, value: unknown) => ({
		column,
		type: "gt",
		value,
	})),
	isNull: vi.fn((column: unknown) => ({ column, type: "isNull" })),
	lt: vi.fn((column: unknown, value: unknown) => ({
		column,
		type: "lt",
		value,
	})),
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
	gt: mockOperators.gt,
	isNull: mockOperators.isNull,
	lt: mockOperators.lt,
	not: mockOperators.not,
	or: mockOperators.or,
}));

vi.mock("@/db", () => ({
	db: {
		select: mockDb.select,
	},
}));

function automaticPeriod() {
	return {
		period: {
			id: "period-auto",
			organizationId: "org-1",
			employeeId: "employee-1",
			startTime: new Date("2026-05-04T06:00:00Z"),
			endTime: new Date("2026-05-04T18:00:00Z"),
			durationMinutes: 720,
			isActive: false,
			clockInId: "in-1",
			clockOutId: "out-auto",
		},
		user: { id: "user-1", name: "Ada" },
		clockInEntry: {
			id: "in-1",
			type: "clock_in",
			createdBy: "user-1",
			createdAt: new Date("2026-05-04T06:00:00Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
		},
		clockOutEntry: {
			id: "out-auto",
			type: "clock_out",
			createdBy: "source-admin",
			createdAt: new Date("2026-05-04T18:03:00Z"),
			utcOffsetMinutes: 120,
			timezone: "Europe/Berlin",
			notes: "editable note",
		},
		clockOutEditorName: "Source Admin",
		clockInEditorName: "Ada",
		automaticExecution: {
			organizationId: "org-1",
			employeeId: "employee-1",
			workPeriodId: "period-auto",
			clockOutEntryId: "out-auto",
			startTime: new Date("2026-05-04T06:00:00Z"),
			cutoffTime: new Date("2026-05-04T18:00:00Z"),
			maxUninterruptedMinutes: 720,
			processedAt: new Date("2026-05-04T18:03:00Z"),
		},
		surcharge: null,
		project: null,
	};
}

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
		mockDb.leftJoin.mockReturnValue({
			leftJoin: mockDb.leftJoin,
			where: mockDb.where,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("exposes immutable scoped execution evidence for the standing automatic endpoint", async () => {
		mockDb.where.mockResolvedValue([automaticPeriod()]);
		const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
		expect(event.metadata.automaticClockOut).toEqual({
			cutoffAt: "2026-05-04T18:00:00Z",
			limitMinutes: 720,
			processedAt: "2026-05-04T18:03:00Z",
		});
		expect(event.metadata.editedByName).toBeUndefined();
		expect(mockDb.leftJoin).toHaveBeenCalledWith(automaticClockOutExecution, {
			type: "and",
			conditions: [
				{
					type: "eq",
					column: automaticClockOutExecution.organizationId,
					value: workPeriod.organizationId,
				},
				{ type: "eq", column: automaticClockOutExecution.employeeId, value: workPeriod.employeeId },
				{
					type: "eq",
					column: automaticClockOutExecution.clockOutEntryId,
					value: workPeriod.clockOutId,
				},
			],
		});
	});
	it("retains human correction audit and removes automatic metadata from its new endpoint", async () => {
		const row = automaticPeriod();
		row.period.clockOutId = "correction-1";
		row.period.endTime = new Date("2026-05-04T17:00:00Z");
		row.clockOutEntry = {
			...row.clockOutEntry,
			id: "correction-1",
			type: "correction",
			createdBy: "manager-1",
			createdAt: new Date("2026-05-05T10:00:00Z"),
		};
		row.clockOutEditorName = "Grace Manager";
		mockDb.where.mockResolvedValue([row]);
		const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
		expect(event.metadata.automaticClockOut).toBeUndefined();
		expect(event.metadata.editedByName).toBe("Grace Manager");
		expect(event.metadata.editedAt).toEqual(new Date("2026-05-05T10:00:00Z"));
	});
	it("preserves automatic clock-out source after a start-only human correction", async () => {
		const row = automaticPeriod();
		row.period.startTime = new Date("2026-05-04T07:00:00Z");
		row.period.clockInId = "in-correction";
		row.clockInEntry = {
			...row.clockInEntry,
			id: "in-correction",
			type: "correction",
			createdBy: "manager-1",
			createdAt: new Date("2026-05-05T10:00:00Z"),
		};
		row.clockInEditorName = "Grace Manager";
		mockDb.where.mockResolvedValue([row]);
		const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
		expect(event.metadata.automaticClockOut).toMatchObject({
			limitMinutes: 720,
			cutoffAt: "2026-05-04T18:00:00Z",
		});
		expect(event.metadata.editedByName).toBe("Grace Manager");
	});
	it.each(["organizationId", "employeeId", "clockOutEntryId"] as const)(
		"refuses mismatched execution %s",
		async (key) => {
			const row = automaticPeriod();
			row.automaticExecution[key] = "other";
			mockDb.where.mockResolvedValue([row]);
			const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
			expect(event.metadata.automaticClockOut).toBeUndefined();
		},
	);
	it("keeps the automatic terminal source after a break deduction or split carries it to another segment", async () => {
		const row = automaticPeriod();
		row.period.id = "period-terminal-segment";
		row.period.startTime = new Date("2026-05-04T16:00:00Z");
		mockDb.where.mockResolvedValue([row]);
		const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
		expect(event.id).toBe("period-terminal-segment");
		expect(event.metadata.automaticClockOut).toEqual({
			cutoffAt: "2026-05-04T18:00:00Z",
			limitMinutes: 720,
			processedAt: "2026-05-04T18:03:00Z",
		});
	});
	it("does not label a modified endpoint time automatic", async () => {
		const row = automaticPeriod();
		row.period.endTime = new Date("2026-05-04T17:00:00Z");
		mockDb.where.mockResolvedValue([row]);
		const [event] = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });
		expect(event.metadata.automaticClockOut).toBeUndefined();
	});

	it("uses employee calendar timezone boundaries when querying month work periods", async () => {
		mockDb.where.mockResolvedValue([]);

		await getWorkPeriodsForMonth(
			4,
			2026,
			{ organizationId: "org-1", employeeId: "employee-1" },
			"America/New_York",
		);

		expect(mockOperators.gt).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-05-01T04:00:00.000Z"),
		);
		expect(mockOperators.lt).toHaveBeenCalledWith(
			expect.anything(),
			new Date("2026-06-01T04:00:00.000Z"),
		);
		expect(mockOperators.eq).toHaveBeenCalledWith(expect.anything(), "org-1");
		expect(mockOperators.eq).toHaveBeenCalledWith(
			expect.anything(),
			"employee-1",
		);
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
								ruleId: "rule-night",
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

		const events = await getWorkPeriodsForMonth(4, 2026, {
			organizationId: "org-1",
		});

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
				isRunning: true,
				projectId: "project-1",
				projectName: "Payroll",
				projectColor: "#2563eb",
				approvalStatus: "pending",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
			},
		});
		expect(events[0]?.metadata.startTime?.replace(/\s/gu, " ")).toBe("8:00 AM");
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

		const events = await getWorkPeriodsForMonth(4, 2026, {
			organizationId: "org-1",
		});

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
	const monthEnd = new Date("2026-06-01T00:00:00.000Z");
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

	it("includes completed periods that cross into the month", () => {
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
		).toBe(true);
	});

	it("uses half-open boundaries for completed periods", () => {
		expect(
			workPeriodOverlapsCalendarMonth(
				{
					startTime: new Date("2026-04-30T20:00:00.000Z"),
					endTime: monthStart,
					isActive: false,
				},
				monthStart,
				monthEnd,
				now,
			),
		).toBe(false);
		expect(
			workPeriodOverlapsCalendarMonth(
				{
					startTime: monthEnd,
					endTime: new Date("2026-06-01T01:00:00.000Z"),
					isActive: false,
				},
				monthStart,
				monthEnd,
				now,
			),
		).toBe(false);
	});

	it("excludes active periods before a future range", () => {
		expect(
			workPeriodOverlapsCalendarMonth(
				{
					startTime: new Date("2026-04-30T20:00:00.000Z"),
					endTime: null,
					isActive: true,
				},
				monthStart,
				monthEnd,
				new Date("2026-04-30T23:59:59.999Z"),
			),
		).toBe(false);
	});
});
