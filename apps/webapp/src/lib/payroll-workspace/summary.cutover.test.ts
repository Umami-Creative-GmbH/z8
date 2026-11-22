import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

const mockState = vi.hoisted(() => ({
	assertCanonicalCutoverReady: vi.fn(),
	assertCanonicalAbsencesReady: vi.fn(),
	isPayrollWorkCollectionActive: vi.fn(),
	readPayrollWorkCollection: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: mockState.select,
	},
}));

vi.mock("@/lib/time-record/migration/cutover-state", () => ({
	assertCanonicalCutoverReady: mockState.assertCanonicalCutoverReady,
	assertCanonicalAbsencesReady: mockState.assertCanonicalAbsencesReady,
}));

vi.mock("@/lib/payroll-collection/payroll-work-collection-reader", () => ({
	isPayrollWorkCollectionActive: mockState.isPayrollWorkCollectionActive,
	readPayrollWorkCollection: mockState.readPayrollWorkCollection,
}));

const { getPayrollWorkspaceSummary } = await import("./summary");

const request = {
	organizationId: "org-1",
	allowedEmployeeIds: [],
	period: {
		start: parsePlainDate("2026-06-01"),
		end: parsePlainDate("2026-06-30"),
		label: "June 2026",
	},
	generatedBy: { id: "payroll-1", name: "Payroll User" },
};

describe("getPayrollWorkspaceSummary canonical cutover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isPayrollWorkCollectionActive.mockResolvedValue(false);
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
			new Error("Canonical time-record backfill is incomplete for organization org-1"),
		);

		await expect(getPayrollWorkspaceSummary(request)).rejects.toThrow(
			"Canonical time-record backfill is incomplete for organization org-1",
		);

		expect(mockState.assertCanonicalCutoverReady).toHaveBeenCalledWith("org-1");
		expect(mockState.select).not.toHaveBeenCalled();
	});

	it("never runs the organization-wide backfill under scoped collection", async () => {
		mockState.isPayrollWorkCollectionActive.mockResolvedValue(true);

		const summary = await getPayrollWorkspaceSummary(request);

		expect(summary.organizationId).toBe("org-1");
		expect(mockState.assertCanonicalAbsencesReady).toHaveBeenCalledWith("org-1");
		expect(mockState.assertCanonicalCutoverReady).not.toHaveBeenCalled();
	});
});
