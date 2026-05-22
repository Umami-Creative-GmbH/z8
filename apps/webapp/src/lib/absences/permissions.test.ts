import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
	canApproveAbsence,
	canApproveAbsenceRecord,
	canEditEmployeeAllowance,
	canSelfCancelAbsenceStatus,
} from "./permissions";

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: vi.fn() },
			employeeManagers: { findFirst: vi.fn() },
		},
	},
}));

const findEmployeeMock = vi.mocked(db.query.employee.findFirst);
const findEmployeeManagerMock = vi.mocked(db.query.employeeManagers.findFirst);

const adminEmployee = {
	id: "admin_employee",
	organizationId: "org_1",
	role: "admin",
};
const managerEmployee = {
	id: "manager_employee",
	organizationId: "org_1",
	role: "manager",
};
const targetEmployee = {
	id: "target_employee",
	organizationId: "org_1",
	role: "employee",
};
const crossOrgTargetEmployee = { ...targetEmployee, organizationId: "org_2" };

function mockEmployees(approver: object | null, target: object | null) {
	findEmployeeMock.mockResolvedValueOnce(approver);
	findEmployeeMock.mockResolvedValueOnce(target);
}

beforeEach(() => {
	findEmployeeMock.mockReset();
	findEmployeeManagerMock.mockReset();
});

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

describe("canApproveAbsence", () => {
	it("allows admins regardless of manager links", async () => {
		mockEmployees(adminEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canApproveAbsence(adminEmployee.id, targetEmployee.id)).resolves.toBe(true);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});

	it("rejects admins from another organization", async () => {
		mockEmployees(adminEmployee, crossOrgTargetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canApproveAbsence(adminEmployee.id, targetEmployee.id)).resolves.toBe(false);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});

	it("allows managers when the employee manager link exists", async () => {
		mockEmployees(managerEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue({
			employeeId: targetEmployee.id,
			managerId: managerEmployee.id,
		});

		await expect(canApproveAbsence(managerEmployee.id, targetEmployee.id)).resolves.toBe(true);
		expect(findEmployeeManagerMock).toHaveBeenCalledTimes(1);
	});

	it("rejects managers when no employee manager link exists", async () => {
		mockEmployees(managerEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canApproveAbsence(managerEmployee.id, targetEmployee.id)).resolves.toBe(false);
	});

	it("rejects managers from another organization even when a manager link exists", async () => {
		mockEmployees(managerEmployee, crossOrgTargetEmployee);
		findEmployeeManagerMock.mockResolvedValue({
			employeeId: targetEmployee.id,
			managerId: managerEmployee.id,
		});

		await expect(canApproveAbsence(managerEmployee.id, targetEmployee.id)).resolves.toBe(false);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});
});

describe("canEditEmployeeAllowance", () => {
	it("allows admins regardless of manager links", async () => {
		mockEmployees(adminEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canEditEmployeeAllowance(adminEmployee.id, targetEmployee.id)).resolves.toBe(
			true,
		);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});

	it("rejects admins from another organization", async () => {
		mockEmployees(adminEmployee, crossOrgTargetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canEditEmployeeAllowance(adminEmployee.id, targetEmployee.id)).resolves.toBe(
			false,
		);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});

	it("allows managers when the employee manager link exists", async () => {
		mockEmployees(managerEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue({
			employeeId: targetEmployee.id,
			managerId: managerEmployee.id,
		});

		await expect(canEditEmployeeAllowance(managerEmployee.id, targetEmployee.id)).resolves.toBe(
			true,
		);
		expect(findEmployeeManagerMock).toHaveBeenCalledTimes(1);
	});

	it("rejects managers when no employee manager link exists", async () => {
		mockEmployees(managerEmployee, targetEmployee);
		findEmployeeManagerMock.mockResolvedValue(null);

		await expect(canEditEmployeeAllowance(managerEmployee.id, targetEmployee.id)).resolves.toBe(
			false,
		);
	});

	it("rejects managers from another organization even when a manager link exists", async () => {
		mockEmployees(managerEmployee, crossOrgTargetEmployee);
		findEmployeeManagerMock.mockResolvedValue({
			employeeId: targetEmployee.id,
			managerId: managerEmployee.id,
		});

		await expect(canEditEmployeeAllowance(managerEmployee.id, targetEmployee.id)).resolves.toBe(
			false,
		);
		expect(findEmployeeManagerMock).not.toHaveBeenCalled();
	});
});
