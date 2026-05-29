import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { employee, employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "./format";

const mockState = vi.hoisted(() => ({
	db: {
		query: {
			employee: {
				findFirst: vi.fn(),
			},
			employeeWorkBalance: {
				findFirst: vi.fn(),
			},
		},
		select: vi.fn(),
		delete: vi.fn(),
		execute: vi.fn(),
		insert: vi.fn(),
		transaction: vi.fn(),
		update: vi.fn(),
	},
	selectFrom: vi.fn(),
	selectWhere: vi.fn(),
	deleteWhere: vi.fn(),
	txDelete: vi.fn(),
	txExecute: vi.fn(),
	txInsert: vi.fn(),
	txInsertValues: vi.fn(),
	txOnConflictDoUpdate: vi.fn(),
	txSelect: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	selectLeftJoin: vi.fn(),
	selectOrderBy: vi.fn(),
	selectLimit: vi.fn(),
	getDailyWorkRequirementsForEmployee: vi.fn(),
	markEmployeeWorkBalanceFullRebuildRequested: vi.fn(),
	computeEmployeePeriodBalance: vi.fn(),
	upsertEmployeeWorkBalancePeriod: vi.fn(),
	rebuildEmployeeYearBalanceFromMonths: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	isNotNull: vi.fn((value: unknown) => ({ isNotNull: value })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	lt: vi.fn((left: unknown, right: unknown) => ({ lt: [left, right] })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	min: vi.fn((value: unknown) => ({ min: value })),
	or: vi.fn((...args: unknown[]) => ({ or: args })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
		sql: Array.from(strings),
		values,
	})),
}));

vi.mock("@/db", () => ({ db: mockState.db }));

vi.mock("@/lib/calendar/work-policy-requirements", () => ({
	getDailyWorkRequirementsForEmployee: mockState.getDailyWorkRequirementsForEmployee,
}));

vi.mock("./period-aggregation", () => ({
	computeEmployeePeriodBalance: mockState.computeEmployeePeriodBalance,
	markEmployeeWorkBalanceFullRebuildRequested:
		mockState.markEmployeeWorkBalanceFullRebuildRequested,
	rebuildEmployeeYearBalanceFromMonths: mockState.rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod: mockState.upsertEmployeeWorkBalancePeriod,
}));

import {
	buildEmptyWorkBalanceValues,
	buildWorkBalanceValues,
	computeEmployeeWorkBalance,
	getEmployeeWorkBalance,
	getWorkBalanceBatchCutoffDate,
	listEmployeesForWorkBalanceBatch,
	markEmployeeWorkBalanceDirty,
	markOrganizationWorkBalancesDirty,
	refreshEmployeeWorkBalanceFromPeriods,
	requestEmployeeWorkBalanceFullRebuild,
	shouldIncludeWorkBalanceInBatch,
	upsertEmployeeWorkBalance,
} from "./service";

describe("work balance helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.db.update.mockReturnValue({ set: mockState.updateSet });
		mockState.selectWhere.mockReset();
		mockState.selectFrom.mockReset();
		mockState.db.select.mockReset();
		mockState.selectLeftJoin.mockReset();
		mockState.selectOrderBy.mockReset();
		mockState.selectLimit.mockReset();
		mockState.deleteWhere.mockReset();
		mockState.db.delete.mockReset();
		mockState.db.delete.mockReturnValue({ where: mockState.deleteWhere });
		mockState.txDelete.mockReset();
		mockState.txDelete.mockReturnValue({ where: mockState.deleteWhere });
		mockState.txExecute.mockReset();
		mockState.txExecute.mockResolvedValue(undefined);
		mockState.db.execute.mockReset();
		mockState.txInsert.mockReset();
		mockState.txInsert.mockReturnValue({ values: mockState.txInsertValues });
		mockState.txInsertValues.mockReset();
		mockState.txInsertValues.mockReturnValue({
			onConflictDoUpdate: mockState.txOnConflictDoUpdate,
		});
		mockState.txOnConflictDoUpdate.mockReset();
		mockState.txSelect.mockReset();
		mockState.txSelect.mockReturnValue({ from: mockState.selectFrom });
		mockState.db.transaction.mockReset();
		mockState.db.transaction.mockImplementation(async (callback) =>
			callback({
				delete: mockState.txDelete,
				execute: mockState.txExecute,
				insert: mockState.txInsert,
				query: mockState.db.query,
				select: mockState.txSelect,
			}),
		);
		mockState.insertValues.mockReset();
		mockState.onConflictDoUpdate.mockReset();
		mockState.db.insert.mockReturnValue({ values: mockState.insertValues });
		mockState.insertValues.mockReturnValue({ onConflictDoUpdate: mockState.onConflictDoUpdate });
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({});
		mockState.computeEmployeePeriodBalance.mockReset();
		mockState.upsertEmployeeWorkBalancePeriod.mockReset();
		mockState.rebuildEmployeeYearBalanceFromMonths.mockReset();
		mockState.upsertEmployeeWorkBalancePeriod.mockResolvedValue(undefined);
		mockState.rebuildEmployeeYearBalanceFromMonths.mockResolvedValue(undefined);
		mockState.db.query.employee.findFirst.mockReset();
		mockState.db.query.employee.findFirst.mockResolvedValue({
			id: "employee-1",
			startDate: null,
			user: { createdAt: new Date("2026-05-01T00:00:00.000Z") },
		});
		mockState.db.query.employeeWorkBalance.findFirst.mockReset();
		mockState.db.query.employeeWorkBalance.findFirst.mockResolvedValue({
			id: "balance-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt: new Date("2026-05-22T12:00:00.000Z"),
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
			updatedAt: new Date("2026-05-22T12:00:00.000Z"),
		});
	});

	it("builds all-time work balance values", () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");

		expect(
			buildWorkBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 2520,
				requiredMinutes: 2400,
				computedFromDate: "2026-05-01",
				computedThroughDate: "2026-05-22",
				computedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
			updatedAt: computedAt,
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
		});
	});

	it("formats signed all-time work balance values", () => {
		expect(formatSignedWorkBalance(750)).toBe("+12:30h");
		expect(formatSignedWorkBalance(-255)).toBe("-4:15h");
		expect(formatSignedWorkBalance(0)).toBe("0:00h");
	});

	it("classifies positive zero and negative balances", () => {
		expect(getWorkBalanceStatus(1)).toBe("positive");
		expect(getWorkBalanceStatus(0)).toBe("neutral");
		expect(getWorkBalanceStatus(-1)).toBe("negative");
	});

	it("uses today's UTC date as the batch cutoff", () => {
		expect(getWorkBalanceBatchCutoffDate(new Date("2026-05-22T23:30:00.000-05:00"))).toBe(
			"2026-05-23",
		);
	});

	it("includes missing dirty or stale balances in batch selection", () => {
		const todayDate = "2026-05-22";

		expect(shouldIncludeWorkBalanceInBatch(null, todayDate)).toBe(true);
		expect(
			shouldIncludeWorkBalanceInBatch(
				{ isDirty: true, computedThroughDate: "2026-05-22" },
				todayDate,
			),
		).toBe(true);
		expect(
			shouldIncludeWorkBalanceInBatch(
				{ isDirty: false, computedThroughDate: "2026-05-21" },
				todayDate,
			),
		).toBe(true);
	});

	it("excludes clean current or future balances from batch selection", () => {
		const todayDate = "2026-05-22";

		expect(
			shouldIncludeWorkBalanceInBatch(
				{ isDirty: false, computedThroughDate: "2026-05-22" },
				todayDate,
			),
		).toBe(false);
		expect(
			shouldIncludeWorkBalanceInBatch(
				{ isDirty: false, computedThroughDate: "2026-05-23" },
				todayDate,
			),
		).toBe(false);
	});

	it("builds clean current empty work balance values", () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");

		expect(
			buildEmptyWorkBalanceValues({
				employeeId: "employee-1",
				organizationId: "org-1",
				computedAt,
			}),
		).toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: "2026-05-22",
			computedThroughDate: "2026-05-22",
			computedAt,
			updatedAt: computedAt,
			isDirty: false,
			dirtyFromDate: null,
			refreshRequestedAt: null,
			lastError: null,
		});
	});

	it("returns only public employee work balance payload fields", async () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employeeWorkBalance.findFirst.mockResolvedValueOnce({
			id: "balance-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
			isDirty: true,
			dirtyFromDate: "2026-05-20",
			refreshRequestedAt: computedAt,
			lastError: "failed",
			updatedAt: computedAt,
		});

		await expect(
			getEmployeeWorkBalance({ employeeId: "employee-1", organizationId: "org-1" }),
		).resolves.toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
		});
	});

	it("returns null for hidden full-rebuild marker rows", async () => {
		const requestedAt = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employeeWorkBalance.findFirst.mockResolvedValueOnce({
			id: "balance-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: "0001-01-01",
			computedThroughDate: "0001-01-01",
			computedAt: requestedAt,
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			lastError: null,
			updatedAt: requestedAt,
		});

		await expect(
			getEmployeeWorkBalance({ employeeId: "employee-1", organizationId: "org-1" }),
		).resolves.toBeNull();
	});

	it("returns org-wide dirty balances with real computed values", async () => {
		const computedAt = new Date("2026-05-22T12:00:00.000Z");
		const refreshRequestedAt = new Date("2026-05-22T12:05:00.000Z");
		mockState.db.query.employeeWorkBalance.findFirst.mockResolvedValueOnce({
			id: "balance-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt,
			lastError: null,
			updatedAt: refreshRequestedAt,
		});

		await expect(
			getEmployeeWorkBalance({ employeeId: "employee-1", organizationId: "org-1" }),
		).resolves.toEqual({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 2520,
			requiredMinutes: 2400,
			balanceMinutes: 120,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt,
		});
	});

	it("marks existing organization work balances dirty", async () => {
		await markOrganizationWorkBalancesDirty({ organizationId: "org-1" });

		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				isDirty: true,
			}),
		);
		expect(mockState.updateWhere).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith(expect.anything(), "org-1");
	});

	it("resets employee work balance recalculation state with a hidden aggregate marker", async () => {
		const requestedAt = new Date("2026-05-22T12:00:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(requestedAt);

		try {
			await requestEmployeeWorkBalanceFullRebuild({
				employeeId: "employee-1",
				organizationId: "org-1",
			});
		} finally {
			vi.useRealTimers();
		}

		expect(mockState.markEmployeeWorkBalanceFullRebuildRequested).not.toHaveBeenCalled();
		expect(mockState.db.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.txExecute).toHaveBeenCalledTimes(1);
		expect(mockState.txExecute).toHaveBeenCalledWith(
			expect.objectContaining({ values: expect.arrayContaining(["work-balance:org-1:employee-1"]) }),
		);
		expect(mockState.txDelete).toHaveBeenCalledTimes(1);
		expect(mockState.txDelete).toHaveBeenCalledWith(employeeWorkBalancePeriod);
		expect(mockState.deleteWhere).toHaveBeenCalledTimes(1);
		expect(mockState.deleteWhere).toHaveBeenCalledWith({
			and: [
				{ eq: [employeeWorkBalancePeriod.employeeId, "employee-1"] },
				{ eq: [employeeWorkBalancePeriod.organizationId, "org-1"] },
			],
		});
		expect(and).toHaveBeenCalledWith(
			{ eq: [employeeWorkBalancePeriod.employeeId, "employee-1"] },
			{ eq: [employeeWorkBalancePeriod.organizationId, "org-1"] },
		);
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.organizationId, "org-1");
		expect(mockState.txInsert).toHaveBeenCalledWith(employeeWorkBalance);
		expect(mockState.txInsertValues).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: "0001-01-01",
			computedThroughDate: "0001-01-01",
			computedAt: requestedAt,
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			lastError: null,
			updatedAt: requestedAt,
		});
		expect(mockState.txOnConflictDoUpdate).toHaveBeenCalledWith({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				actualMinutes: 0,
				requiredMinutes: 0,
				balanceMinutes: 0,
				computedFromDate: "0001-01-01",
				computedThroughDate: "0001-01-01",
				computedAt: requestedAt,
				isDirty: true,
				dirtyFromDate: null,
				refreshRequestedAt: requestedAt,
				lastError: null,
				updatedAt: requestedAt,
			},
		});
	});

	it("preserves dirty state when a newer refresh request arrives during computation", async () => {
		const values = buildWorkBalanceValues({
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 480,
			requiredMinutes: 480,
			computedFromDate: "2026-05-01",
			computedThroughDate: "2026-05-22",
			computedAt: new Date("2026-05-22T12:00:10.000Z"),
		});
		const refreshStartedAt = new Date("2026-05-22T12:00:00.000Z");

		await upsertEmployeeWorkBalance(values, { refreshStartedAt });

		expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					isDirty: expect.objectContaining({ values: expect.arrayContaining([refreshStartedAt]) }),
					dirtyFromDate: expect.objectContaining({ values: expect.arrayContaining([refreshStartedAt]) }),
					refreshRequestedAt: expect.objectContaining({ values: expect.arrayContaining([refreshStartedAt]) }),
				}),
			}),
		);
	});

	it("preserves a pending full rebuild when a later date-scoped dirty mark arrives", async () => {
		await markEmployeeWorkBalanceDirty({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-10",
		});

		expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					dirtyFromDate: expect.objectContaining({
						sql: expect.arrayContaining([expect.stringContaining("then null")]),
						values: expect.arrayContaining([
							employeeWorkBalance.isDirty,
							employeeWorkBalance.dirtyFromDate,
							"2026-05-10",
						]),
					}),
				}),
			}),
		);
	});

	it("uses the first completed work period as the all-time balance start", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-10T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({
			"2026-05-10": { requiredMinutes: 480 },
		});

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-10",
				actualMinutes: 480,
				requiredMinutes: 480,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				startDate: new Date("2026-05-10T00:00:00.000Z"),
			}),
		);
	});

	it("uses employee start date before the first completed work period", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			user: { createdAt: new Date("2026-05-15T10:30:00.000Z") },
		});
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({
			"2026-05-20": { requiredMinutes: 480 },
		});

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-01",
				actualMinutes: 480,
				requiredMinutes: 480,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);
	});

	it("does not compute a work balance before the first completed work period exists", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([{ value: null }]);

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toBeNull();
		expect(mockState.getDailyWorkRequirementsForEmployee).not.toHaveBeenCalled();
	});

	it("uses the first completed work period when imported work predates the account", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-10T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: null,
			user: { createdAt: new Date("2026-05-15T10:30:00.000Z") },
		});

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-10",
				actualMinutes: 480,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: new Date("2026-05-10T00:00:00.000Z"),
			}),
		);
	});

	it("includes completed legacy periods even when isActive is stale", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-03T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ totalMinutes: 450 }]);
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: null,
			user: { createdAt: new Date("2026-05-03T00:00:00.000Z") },
		});
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({});

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-03",
				actualMinutes: 450,
			}),
		);
		expect(eq).not.toHaveBeenCalledWith(expect.anything(), false);
		expect(isNotNull).toHaveBeenCalledWith(workPeriod.endTime);
	});

	it("includes dirty metadata in employees selected for work balance refresh", async () => {
		const rows = [
			{
				id: "employee-1",
				organizationId: "org-1",
				balanceId: "balance-1",
				isDirty: true,
				dirtyFromDate: "2026-02-10",
				refreshRequestedAt: new Date("2026-05-22T11:59:00.000Z"),
			},
		];
		mockState.db.select.mockReturnValueOnce({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ leftJoin: mockState.selectLeftJoin });
		mockState.selectLeftJoin.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockReturnValueOnce({ orderBy: mockState.selectOrderBy });
		mockState.selectOrderBy.mockReturnValueOnce({ limit: mockState.selectLimit });
		mockState.selectLimit.mockResolvedValueOnce(rows);

		await expect(
			listEmployeesForWorkBalanceBatch(10, new Date("2026-05-22T12:00:00.000Z")),
		).resolves.toBe(rows);

		expect(mockState.db.select).toHaveBeenCalledWith({
			id: employee.id,
			organizationId: employee.organizationId,
			balanceId: employeeWorkBalance.id,
			isDirty: employeeWorkBalance.isDirty,
			dirtyFromDate: employeeWorkBalance.dirtyFromDate,
			refreshRequestedAt: employeeWorkBalance.refreshRequestedAt,
		});
	});

	it("refreshes old dirty months rebuilds years and upserts read model from closed plus hot totals", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.computeEmployeePeriodBalance
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 100,
				requiredMinutes: 80,
				balanceMinutes: 20,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-03-01",
				periodEnd: "2026-05-22",
				actualMinutes: 300,
				requiredMinutes: 240,
				balanceMinutes: 60,
				computedAt: now,
				isClosed: false,
			});
		mockState.db.select.mockReturnValueOnce({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([
			{ actualMinutes: 300, requiredMinutes: 240, firstPeriodStart: "2026-02-01" },
		]);

		await expect(
			refreshEmployeeWorkBalanceFromPeriods({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: "2026-02-10",
				now,
			}),
		).resolves.toEqual({ updated: true });

		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(1, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
			calculationStartDate: null,
			isClosed: true,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(2, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			calculationStartDate: null,
			isClosed: false,
			now,
		});
		expect(mockState.upsertEmployeeWorkBalancePeriod).toHaveBeenCalledTimes(1);
		expect(mockState.upsertEmployeeWorkBalancePeriod).toHaveBeenCalledWith(
			expect.objectContaining({ periodStart: "2026-02-01" }),
			{ dbClient: expect.objectContaining({ insert: mockState.txInsert }), refreshStartedAt: now },
		);
		expect(mockState.rebuildEmployeeYearBalanceFromMonths).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			dateInYear: "2026-01-01",
			now,
		});
		expect(mockState.txSelect).toHaveBeenCalledWith({
			actualMinutes: expect.anything(),
			requiredMinutes: expect.anything(),
			firstPeriodStart: expect.anything(),
		});
		expect(mockState.txInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 600,
				requiredMinutes: 480,
				balanceMinutes: 120,
				computedFromDate: "2026-02-01",
				computedThroughDate: "2026-05-22",
			}),
		);
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.organizationId, "org-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.employeeId, "employee-1");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.periodType, "month");
		expect(eq).toHaveBeenCalledWith(employeeWorkBalancePeriod.isClosed, true);
	});

	it("uses the first relevant date for force full rebuilds with null dirty date", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({ id: "employee-1" });
		mockState.computeEmployeePeriodBalance
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-01-01",
				periodEnd: "2026-01-31",
				actualMinutes: 100,
				requiredMinutes: 80,
				balanceMinutes: 20,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 200,
				requiredMinutes: 160,
				balanceMinutes: 40,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-03-01",
				periodEnd: "2026-05-22",
				actualMinutes: 300,
				requiredMinutes: 240,
				balanceMinutes: 60,
				computedAt: now,
				isClosed: false,
			});
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-01-15T09:00:00.000Z") }])
			.mockResolvedValueOnce([
				{ actualMinutes: 300, requiredMinutes: 240, firstPeriodStart: "2026-01-01" },
			]);

		await expect(
			refreshEmployeeWorkBalanceFromPeriods({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: null,
				forceFullRebuild: true,
				now,
			}),
		).resolves.toEqual({ updated: true });

		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(1, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-01-01",
			periodEnd: "2026-01-31",
			calculationStartDate: "2026-01-15",
			isClosed: true,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(2, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
			calculationStartDate: "2026-01-15",
			isClosed: true,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(3, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			calculationStartDate: "2026-01-15",
			isClosed: false,
			now,
		});
		expect(mockState.upsertEmployeeWorkBalancePeriod).toHaveBeenCalledTimes(2);
		expect(mockState.rebuildEmployeeYearBalanceFromMonths).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			dateInYear: "2026-01-01",
			now,
		});
	});

	it("promotes a preselected stale refresh to full rebuild when the current row is a reset marker", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employeeWorkBalance.findFirst.mockResolvedValueOnce({
			id: "balance-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: "0001-01-01",
			computedThroughDate: "0001-01-01",
			computedAt: now,
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: now,
			lastError: null,
			updatedAt: now,
		});
		mockState.computeEmployeePeriodBalance
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-01-01",
				periodEnd: "2026-01-31",
				actualMinutes: 100,
				requiredMinutes: 80,
				balanceMinutes: 20,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 200,
				requiredMinutes: 160,
				balanceMinutes: 40,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-03-01",
				periodEnd: "2026-05-22",
				actualMinutes: 300,
				requiredMinutes: 240,
				balanceMinutes: 60,
				computedAt: now,
				isClosed: false,
			});
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-01-15T09:00:00.000Z") }])
			.mockResolvedValueOnce([
				{ actualMinutes: 300, requiredMinutes: 240, firstPeriodStart: "2026-01-01" },
			]);

		await expect(
			refreshEmployeeWorkBalanceFromPeriods({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: null,
				forceFullRebuild: false,
				now,
			}),
		).resolves.toEqual({ updated: true });

		expect(mockState.txExecute).toHaveBeenCalledWith(
			expect.objectContaining({ values: expect.arrayContaining(["work-balance:org-1:employee-1"]) }),
		);
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(1, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-01-01",
			periodEnd: "2026-01-31",
			calculationStartDate: "2026-01-15",
			isClosed: true,
			now,
		});
		expect(mockState.upsertEmployeeWorkBalancePeriod).toHaveBeenCalledTimes(2);
		expect(mockState.rebuildEmployeeYearBalanceFromMonths).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			dateInYear: "2026-01-01",
			now,
		});
	});

	it("does not rebuild closed months before employee start date", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: new Date("2026-02-10T00:00:00.000Z"),
		});
		mockState.computeEmployeePeriodBalance
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-02-01",
				periodEnd: "2026-02-28",
				actualMinutes: 100,
				requiredMinutes: 80,
				balanceMinutes: 20,
				computedAt: now,
				isClosed: true,
			})
			.mockResolvedValueOnce({
				employeeId: "employee-1",
				organizationId: "org-1",
				periodType: "month",
				periodStart: "2026-03-01",
				periodEnd: "2026-05-22",
				actualMinutes: 300,
				requiredMinutes: 240,
				balanceMinutes: 60,
				computedAt: now,
				isClosed: false,
			});
		mockState.db.select.mockReturnValueOnce({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([
			{ actualMinutes: 100, requiredMinutes: 80, firstPeriodStart: "2026-01-01" },
		]);

		await refreshEmployeeWorkBalanceFromPeriods({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-01-01",
			now,
		});

		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(1, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-02-01",
			periodEnd: "2026-02-28",
			calculationStartDate: "2026-02-10",
			isClosed: true,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenNthCalledWith(2, {
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			calculationStartDate: "2026-02-10",
			isClosed: false,
			now,
		});
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenCalledTimes(2);
		expect(gte).toHaveBeenCalledWith(employeeWorkBalancePeriod.periodEnd, "2026-02-10");
		expect(mockState.txInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				actualMinutes: 400,
				requiredMinutes: 320,
				balanceMinutes: 80,
				computedFromDate: "2026-02-10",
				computedThroughDate: "2026-05-22",
			}),
		);
	});

	it("keeps null dirty date stale refreshes scoped to the hot window", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		mockState.computeEmployeePeriodBalance.mockResolvedValueOnce({
			employeeId: "employee-1",
			organizationId: "org-1",
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			actualMinutes: 300,
			requiredMinutes: 240,
			balanceMinutes: 60,
			computedAt: now,
			isClosed: false,
		});
		mockState.db.select.mockReturnValueOnce({ from: mockState.selectFrom });
		mockState.selectFrom.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere.mockResolvedValueOnce([
			{ actualMinutes: 0, requiredMinutes: 0, firstPeriodStart: null },
		]);

		await refreshEmployeeWorkBalanceFromPeriods({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: null,
			now,
		});

		expect(mockState.computeEmployeePeriodBalance).toHaveBeenCalledTimes(1);
		expect(mockState.computeEmployeePeriodBalance).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dbClient: expect.objectContaining({ select: mockState.txSelect }),
			periodType: "month",
			periodStart: "2026-03-01",
			periodEnd: "2026-05-22",
			calculationStartDate: null,
			isClosed: false,
			now,
		});
		expect(mockState.upsertEmployeeWorkBalancePeriod).not.toHaveBeenCalled();
		expect(mockState.rebuildEmployeeYearBalanceFromMonths).not.toHaveBeenCalled();
	});
});
