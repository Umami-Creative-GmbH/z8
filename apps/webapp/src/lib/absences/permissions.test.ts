import { describe, expect, it } from "vitest";
import { canApproveAbsenceRecord, canSelfCancelAbsenceStatus } from "./permissions";

describe("canApproveAbsenceRecord", () => {
	it("allows admins in the same organization", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "admin-1", role: "admin", organizationId: "org-1" },
				absence: { employeeId: "employee-1", organizationId: "org-1" },
				managedEmployeeIds: [],
			}),
		).toBe(true);
	});

	it("allows managers for direct reports in the same organization", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "manager-1", role: "manager", organizationId: "org-1" },
				absence: { employeeId: "employee-1", organizationId: "org-1" },
				managedEmployeeIds: ["employee-1"],
			}),
		).toBe(true);
	});

	it("denies cross-organization absence approval", () => {
		expect(
			canApproveAbsenceRecord({
				approver: { id: "admin-1", role: "admin", organizationId: "org-1" },
				absence: { employeeId: "employee-1", organizationId: "org-2" },
				managedEmployeeIds: ["employee-1"],
			}),
		).toBe(false);
	});
});

describe("canSelfCancelAbsenceStatus", () => {
	const today = "2026-05-20";

	it("allows pending absences regardless of start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "pending", startDate: "2026-05-19", today }),
		).toBe(true);
	});

	it("allows approved absences only before the start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-21", today }),
		).toBe(true);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-20", today }),
		).toBe(false);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-19", today }),
		).toBe(false);
	});

	it("rejects rejected absences", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "rejected", startDate: "2026-05-21", today }),
		).toBe(false);
	});
});
