import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { workPeriod } from "@/db/schema";
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

import {
	buildEmptyWorkBalanceValues,
	buildWorkBalanceValues,
	computeEmployeeWorkBalance,
	getEmployeeWorkBalance,
	getWorkBalanceBatchCutoffDate,
	markOrganizationWorkBalancesDirty,
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
		mockState.insertValues.mockReset();
		mockState.onConflictDoUpdate.mockReset();
		mockState.db.insert.mockReturnValue({ values: mockState.insertValues });
		mockState.insertValues.mockReturnValue({ onConflictDoUpdate: mockState.onConflictDoUpdate });
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({});
		mockState.db.query.employee.findFirst.mockReset();
		mockState.db.query.employee.findFirst.mockResolvedValue({
			id: "employee-1",
			startDate: null,
			user: { createdAt: new Date("2026-05-01T00:00:00.000Z") },
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

	it("uses the account creation date as the all-time balance start when it predates work and absences", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-10T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ value: "2026-05-08" }])
			.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({
			"2026-05-01": { requiredMinutes: 480 },
			"2026-05-04": { requiredMinutes: 480 },
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
				requiredMinutes: 960,
				balanceMinutes: -480,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				startDate: new Date("2026-05-01T00:00:00.000Z"),
			}),
		);
	});

	it("uses the account creation date when no completed work predates the account", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-20T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ value: "2026-05-08" }])
			.mockResolvedValueOnce([{ totalMinutes: 480 }]);
		mockState.db.query.employee.findFirst.mockResolvedValueOnce({
			id: "employee-1",
			startDate: new Date("2026-05-01T00:00:00.000Z"),
			user: { createdAt: new Date("2026-05-15T10:30:00.000Z") },
		});
		mockState.getDailyWorkRequirementsForEmployee.mockResolvedValue({
			"2026-05-15": { requiredMinutes: 480 },
		});

		const result = await computeEmployeeWorkBalance({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-05-22T12:00:00.000Z"),
		});

		expect(result).toEqual(
			expect.objectContaining({
				computedFromDate: "2026-05-15",
				actualMinutes: 480,
				requiredMinutes: 480,
				balanceMinutes: 0,
			}),
		);
		expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith(
			expect.objectContaining({
				startDate: new Date("2026-05-15T00:00:00.000Z"),
			}),
		);
	});

	it("uses the first completed work period when imported work predates the account", async () => {
		mockState.db.select.mockReturnValue({ from: mockState.selectFrom });
		mockState.selectFrom
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-10T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ value: null }])
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
			.mockReturnValueOnce({ where: mockState.selectWhere })
			.mockReturnValueOnce({ where: mockState.selectWhere });
		mockState.selectWhere
			.mockResolvedValueOnce([{ value: new Date("2026-05-03T09:00:00.000Z") }])
			.mockResolvedValueOnce([{ value: null }])
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
});
