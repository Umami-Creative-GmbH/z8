import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
	canApproveAbsence,
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
	managerId: null,
};
const managerEmployee = {
	id: "manager_employee",
	organizationId: "org_1",
	role: "manager",
	managerId: null,
};
const targetEmployee = {
	id: "target_employee",
	organizationId: "org_1",
	role: "employee",
	managerId: null,
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
		mockEmployees(managerEmployee, { ...targetEmployee, managerId: managerEmployee.id });
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
		mockEmployees(managerEmployee, { ...targetEmployee, managerId: managerEmployee.id });
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
