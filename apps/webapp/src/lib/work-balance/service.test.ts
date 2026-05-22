import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { formatSignedWorkBalance, getWorkBalanceStatus } from "./format";

const mockState = vi.hoisted(() => ({
	db: {
		query: {
			employeeWorkBalance: {
				findFirst: vi.fn(),
			},
		},
		update: vi.fn(),
	},
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
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

import {
	buildEmptyWorkBalanceValues,
	buildWorkBalanceValues,
	getEmployeeWorkBalance,
	getWorkBalanceBatchCutoffDate,
	markOrganizationWorkBalancesDirty,
	shouldIncludeWorkBalanceInBatch,
} from "./service";

describe("work balance helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updateWhere.mockResolvedValue(undefined);
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.db.update.mockReturnValue({ set: mockState.updateSet });
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
});
