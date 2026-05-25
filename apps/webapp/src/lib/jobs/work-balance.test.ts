import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	listEmployeesForWorkBalanceBatch: vi.fn(),
	markEmployeeWorkBalanceFailed: vi.fn(),
	refreshEmployeeWorkBalanceFromPeriods: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn() }),
}));

vi.mock("@/lib/work-balance/service", () => ({
	listEmployeesForWorkBalanceBatch: mockState.listEmployeesForWorkBalanceBatch,
	markEmployeeWorkBalanceFailed: mockState.markEmployeeWorkBalanceFailed,
	refreshEmployeeWorkBalanceFromPeriods: mockState.refreshEmployeeWorkBalanceFromPeriods,
}));

import { runWorkBalanceRefresh } from "./work-balance";

describe("runWorkBalanceRefresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.markEmployeeWorkBalanceFailed.mockResolvedValue(undefined);
	});

	it("refreshes selected employees from dirty period ranges and records per-employee failures", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		mockState.listEmployeesForWorkBalanceBatch.mockResolvedValueOnce([
			{
				id: "employee-1",
				organizationId: "org-1",
				isDirty: true,
				dirtyFromDate: "2026-02-10",
				refreshRequestedAt: new Date("2026-05-22T11:59:00.000Z"),
			},
			{
				id: "employee-2",
				organizationId: "org-1",
				isDirty: false,
				dirtyFromDate: null,
				refreshRequestedAt: null,
			},
		]);
		mockState.refreshEmployeeWorkBalanceFromPeriods
			.mockResolvedValueOnce({ updated: true })
			.mockRejectedValueOnce(new Error("period refresh failed"));

		try {
			const result = await runWorkBalanceRefresh();

			expect(mockState.refreshEmployeeWorkBalanceFromPeriods).toHaveBeenNthCalledWith(1, {
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: "2026-02-10",
				forceFullRebuild: false,
				now,
			});
			expect(mockState.refreshEmployeeWorkBalanceFromPeriods).toHaveBeenNthCalledWith(2, {
				employeeId: "employee-2",
				organizationId: "org-1",
				dirtyFromDate: null,
				forceFullRebuild: false,
				now,
			});
			expect(mockState.markEmployeeWorkBalanceFailed).toHaveBeenCalledWith({
				employeeId: "employee-2",
				organizationId: "org-1",
				error: "period refresh failed",
			});
			expect(result).toEqual({
				success: false,
				employeesProcessed: 2,
				balancesUpdated: 1,
				skipped: 0,
				batchLimit: 1000,
				errors: [
					{
						employeeId: "employee-2",
						organizationId: "org-1",
						error: "period refresh failed",
					},
				],
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("marks a dirty null-date refresh request as a force full rebuild", async () => {
		const now = new Date("2026-05-22T12:00:00.000Z");
		const refreshRequestedAt = new Date("2026-05-22T11:59:00.000Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		mockState.listEmployeesForWorkBalanceBatch.mockResolvedValueOnce([
			{
				id: "employee-1",
				organizationId: "org-1",
				isDirty: true,
				dirtyFromDate: null,
				refreshRequestedAt,
			},
		]);
		mockState.refreshEmployeeWorkBalanceFromPeriods.mockResolvedValueOnce({ updated: true });

		try {
			await runWorkBalanceRefresh();

			expect(mockState.refreshEmployeeWorkBalanceFromPeriods).toHaveBeenCalledWith({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: null,
				forceFullRebuild: true,
				now,
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
