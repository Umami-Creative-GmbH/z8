import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileLegacyToCanonical = vi.fn();
const runCanonicalBackfill = vi.fn();
const findFirstEmployee = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: findFirstEmployee,
			},
		},
	},
	employee: {
		organizationId: "employee.organizationId",
	},
}));

vi.mock("./reconciliation", () => ({
	reconcileLegacyToCanonical,
}));

vi.mock("./backfill", () => ({
	runCanonicalBackfill,
}));

const { assertCanonicalCutoverReady } = await import("./cutover-state");

describe("assertCanonicalCutoverReady", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes after running backfill repair for a mismatched organization", async () => {
		findFirstEmployee.mockResolvedValue({ userId: "user-1" });
		reconcileLegacyToCanonical
			.mockResolvedValueOnce({
				workCountMismatch: 1,
				absenceCountMismatch: 0,
				durationMismatchRecords: 0,
				missingWorkCanonicalRecords: 0,
				missingAbsenceCanonicalRecords: 0,
				missingWorkDetailRows: 0,
				missingAbsenceDetailRows: 0,
				missingProjectAllocationRows: 0,
				approvalStateMismatchRecords: 0,
				missingAbsenceCanonicalLinks: 0,
				missingAbsenceOrganizationIds: 0,
			})
			.mockResolvedValueOnce({
				workCountMismatch: 0,
				absenceCountMismatch: 0,
				durationMismatchRecords: 0,
				missingWorkCanonicalRecords: 0,
				missingAbsenceCanonicalRecords: 0,
				missingWorkDetailRows: 0,
				missingAbsenceDetailRows: 0,
				missingProjectAllocationRows: 0,
				approvalStateMismatchRecords: 0,
				missingAbsenceCanonicalLinks: 0,
				missingAbsenceOrganizationIds: 0,
			});

		await expect(assertCanonicalCutoverReady("org-1")).resolves.toBeUndefined();
		expect(runCanonicalBackfill).toHaveBeenCalledWith({ organizationId: "org-1", actorId: "user-1" });
		expect(reconcileLegacyToCanonical).toHaveBeenCalledTimes(2);
	});

	it("throws when repair backfill still leaves canonical mismatches", async () => {
		findFirstEmployee.mockResolvedValue({ userId: "user-1" });
		reconcileLegacyToCanonical
			.mockResolvedValueOnce({
				workCountMismatch: 1,
				absenceCountMismatch: 0,
				durationMismatchRecords: 0,
				missingWorkCanonicalRecords: 0,
				missingAbsenceCanonicalRecords: 0,
				missingWorkDetailRows: 0,
				missingAbsenceDetailRows: 0,
				missingProjectAllocationRows: 0,
				approvalStateMismatchRecords: 0,
				missingAbsenceCanonicalLinks: 0,
				missingAbsenceOrganizationIds: 0,
			})
			.mockResolvedValueOnce({
				workCountMismatch: 1,
				absenceCountMismatch: 0,
				durationMismatchRecords: 0,
				missingWorkCanonicalRecords: 0,
				missingAbsenceCanonicalRecords: 0,
				missingWorkDetailRows: 0,
				missingAbsenceDetailRows: 0,
				missingProjectAllocationRows: 0,
				approvalStateMismatchRecords: 0,
				missingAbsenceCanonicalLinks: 0,
				missingAbsenceOrganizationIds: 0,
			});

		await expect(assertCanonicalCutoverReady("org-1")).rejects.toThrow(
			"Canonical time-record backfill is incomplete for organization org-1",
		);
		expect(runCanonicalBackfill).toHaveBeenCalledWith({ organizationId: "org-1", actorId: "user-1" });
		expect(reconcileLegacyToCanonical).toHaveBeenCalledTimes(2);
	});

	it("does not run backfill when reconciliation is already clean", async () => {
		reconcileLegacyToCanonical.mockResolvedValue({
			workCountMismatch: 0,
			absenceCountMismatch: 0,
			durationMismatchRecords: 0,
			missingWorkCanonicalRecords: 0,
			missingAbsenceCanonicalRecords: 0,
			missingWorkDetailRows: 0,
			missingAbsenceDetailRows: 0,
			missingProjectAllocationRows: 0,
			approvalStateMismatchRecords: 0,
			missingAbsenceCanonicalLinks: 0,
			missingAbsenceOrganizationIds: 0,
		});

		await expect(assertCanonicalCutoverReady("org-1")).resolves.toBeUndefined();
		expect(runCanonicalBackfill).not.toHaveBeenCalled();
	});
});
