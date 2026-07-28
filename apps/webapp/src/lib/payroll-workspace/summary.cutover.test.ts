import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	assertCanonicalCutoverReady: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/lib/time-record/migration/cutover-state", () => ({
	assertCanonicalCutoverReady: mockState.assertCanonicalCutoverReady,
}));

const { getPayrollWorkspaceSummary } = await import("./summary");

describe("getPayrollWorkspaceSummary canonical cutover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.select.mockReturnValue({
			from: () => ({
				where: () => ({
					limit: async () => [{ name: "Acme GmbH" }],
				}),
			}),
		});
	});

	it("does not calculate payroll totals from an incomplete canonical dataset", async () => {
		mockState.assertCanonicalCutoverReady.mockRejectedValue(
			new Error(
				"Canonical time-record backfill is incomplete for organization org-1",
			),
		);

		await expect(
			getPayrollWorkspaceSummary({
				organizationId: "org-1",
				allowedEmployeeIds: [],
				period: {
					start: DateTime.fromISO("2026-06-01", { zone: "utc" }),
					end: DateTime.fromISO("2026-06-30", { zone: "utc" }),
					label: "June 2026",
				},
				generatedBy: { id: "payroll-1", name: "Payroll User" },
			}),
		).rejects.toThrow(
			"Canonical time-record backfill is incomplete for organization org-1",
		);

		expect(mockState.assertCanonicalCutoverReady).toHaveBeenCalledWith("org-1");
		expect(mockState.select).not.toHaveBeenCalled();
	});
});
