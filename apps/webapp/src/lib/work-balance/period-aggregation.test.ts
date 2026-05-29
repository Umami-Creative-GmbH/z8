import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, gte, isNotNull, lte } from "drizzle-orm";
import { employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";

const mockState = vi.hoisted(() => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
	},
	selectFrom: vi.fn(),
	selectWhere: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	getDailyWorkRequirementsForEmployee: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	isNotNull: vi.fn((value: unknown) => ({ isNotNull: value })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
		sql: Array.from(strings),
		values,
	})),
}));

vi.mock("@/db", () => ({ db: mockState.db }));

vi.mock("@/lib/calendar/work-policy-requirements", () => ({
	getDailyWorkRequirementsForEmployee: mockState.getDailyWorkRequirementsForEmployee,
}));

import {
	buildPeriodBalanceValues,
	computeEmployeePeriodBalance,
	markEmployeeWorkBalanceFullRebuildRequested,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";

describe("work balance period aggregation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValue({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValue([{ totalMinutes: 0 }]);
		mockState.db.insert.mockReturnValue({ values: mockState.insertValues });
		mockState.insertValues.mockReturnValue({ onConflictDoUpdate: mockState.onConflictDoUpdate });
		mockState.onConflictDoUpdate.mockResolvedValue(undefined);
		mockState.db.update.mockReturnValue({ set: mockState.updateSet });
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({});
	});

	it("builds clean period balance values with derived balance and timestamps", () => {
		const computedAt = new Date("2026-05-31T23:59:00.000Z");

		expect(
			buildPeriodBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-05-01",
				periodEnd: "2026-05-31",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				computedAt,
				isClosed: true,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedAt,
			isClosed: true,
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
			updatedAt: computedAt,
		});
	});

	it("computes employee period balances from completed work periods and daily requirements", async () => {
		mockState.selectWhere.mockResolvedValueOnce([{ totalMinutes: 930 }]);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValueOnce({
			"2026-05-01": { requiredMinutes: 480 },
			"2026-05-02": { requiredMinutes: 360 },
		});

		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			isClosed: true,
			now: new Date("2026-06-01T08:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				actualMinutes: 930,
				requiredMinutes: 840,
				balanceMinutes: 90,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});
		expect(eq).toHaveBeenCalledWith(workPeriod.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(workPeriod.organizationId, "org-1");
		expect(isNotNull).toHaveBeenCalledWith(workPeriod.endTime);
		expect(isNotNull).toHaveBeenCalledWith(workPeriod.durationMinutes);
		expect(gte).toHaveBeenCalledWith(workPeriod.startTime, new Date("2026-05-01T00:00:00.000Z"));
		expect(lte).toHaveBeenCalledWith(workPeriod.startTime, new Date("2026-05-31T23:59:59.999Z"));
	});

	it("clips period source queries to the employee calculation start date", async () => {
		mockState.selectWhere.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValueOnce({
			"2026-05-10": { requiredMinutes: 480 },
		});

		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			calculationStartDate: "2026-05-10",
			isClosed: true,
			now: new Date("2026-06-01T08:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				periodStart: "2026-05-01",
				periodEnd: "2026-05-31",
				actualMinutes: 480,
				requiredMinutes: 480,
			}),
		);
		expect(gte).toHaveBeenCalledWith(workPeriod.startTime, new Date("2026-05-10T00:00:00.000Z"));
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			startDate: new Date("2026-05-10T00:00:00.000Z"),
			endDate: new Date("2026-05-31T23:59:59.999Z"),
		});
	});

	it("returns a zero period when the calculation start date is after the period end", async () => {
		const result = await computeEmployeePeriodBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			calculationStartDate: "2026-06-10",
			isClosed: false,
			now: new Date("2026-05-22T08:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				periodStart: "2026-05-01",
				periodEnd: "2026-05-31",
				actualMinutes: 0,
				requiredMinutes: 0,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.db.select).not.toHaveBeenCalled();
		expect(mockState.getDailyWorkRequirementsForEmployee).not.toHaveBeenCalled();
	});

	it("upserts employee period balances on the organization employee type and start conflict target", async () => {
		const values = buildPeriodBalanceValues({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			computedAt: new Date("2026-06-01T08:00:00.000Z"),
			isClosed: true,
		});

		await upsertEmployeeWorkBalancePeriod(values);

		expect(mockState.db.insert).toHaveBeenCalledWith(employeeWorkBalancePeriod);
		expect(mockState.insertValues).toHaveBeenCalledWith(values);
		expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith({
			target: [
				employeeWorkBalancePeriod.organizationId,
				employeeWorkBalancePeriod.employeeId,
				employeeWorkBalancePeriod.periodType,
				employeeWorkBalancePeriod.periodStart,
			],
			set: expect.objectContaining({
				periodEnd: "2026-05-31",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				balanceMinutes: 120,
				computedAt: values.computedAt,
				isClosed: true,
				lastError: null,
				updatedAt: values.updatedAt,
			}),
		});
	});

	it("preserves period dirty state when a newer refresh request arrives during computation", async () => {
		const values = buildPeriodBalanceValues({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-05-01",
			periodEnd: "2026-05-31",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			computedAt: new Date("2026-06-01T08:00:10.000Z"),
			isClosed: true,
		});
		const refreshStartedAt = new Date("2026-06-01T08:00:00.000Z");

		await upsertEmployeeWorkBalancePeriod(values, { refreshStartedAt });

		expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					isDirty: expect.objectContaining({ values: expect.arrayContaining([refreshStartedAt]) }),
					dirtyFromDate: expect.objectContaining({ values: expect.arrayContaining([refreshStartedAt]) }),
					refreshRequestedAt: expect.objectContaining({
						values: expect.arrayContaining([refreshStartedAt]),
					}),
				}),
			}),
		);
	});

	it("rebuilds a closed year bucket from closed monthly buckets", async () => {
		mockState.selectWhere.mockResolvedValueOnce([{ actualMinutes: 18_600, requiredMinutes: 19_200 }]);

		await rebuildEmployeeYearBalanceFromMonths({
			employeeId: "employee-1",
			organizationId: "org-1",
			dateInYear: "2026-05-18",
			now: new Date("2027-01-02T10:00:00.000Z"),
		});

		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "year",
				periodStart: "2026-01-01",
				periodEnd: "2026-12-31",
				actualMinutes: 18_600,
				requiredMinutes: 19_200,
				balanceMinutes: -600,
				isClosed: true,
			}),
		);
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.organizationId, "org-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.periodType, "month");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.isClosed, true);
		expect(gte).toHaveBeenCalledWith(employeeWorkBalancePeriod.periodStart, "2026-01-01");
		expect(lte).toHaveBeenCalledWith(employeeWorkBalancePeriod.periodEnd, "2026-12-31");
	});

	it("marks period buckets and employee read model dirty for an org-scoped full rebuild", async () => {
		const requestedAt = new Date("2026-06-01T08:00:00.000Z");

		await markEmployeeWorkBalanceFullRebuildRequested({
			employeeId: "employee-1",
			organizationId: "org-1",
			requestedAt,
		});

		expect(mockState.db.update).toHaveBeenNthCalledWith(1, employeeWorkBalancePeriod);
		expect(mockState.db.update).toHaveBeenNthCalledWith(2, employeeWorkBalance);
		expect(mockState.updateSet).toHaveBeenNthCalledWith(1, {
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		});
		expect(mockState.updateSet).toHaveBeenNthCalledWith(2, {
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		});
		expect(mockState.updateWhere).toHaveBeenCalledTimes(2);
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.organizationId, "org-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalance.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalance.organizationId, "org-1");
		expect(mockState.db.select).not.toHaveBeenCalled();
		expect(mockState.db.insert).not.toHaveBeenCalled();
	});
});
