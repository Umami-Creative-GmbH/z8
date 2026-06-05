import { describe, expect, it } from "vitest";
import { resolveScopedPayrollEmployeeIdsForAction } from "./actions";

describe("resolveScopedPayrollEmployeeIdsForAction", () => {
	it("returns requested employee IDs for admins", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				requestedEmployeeIds: ["employee-3", "employee-1"],
				allowedEmployeeIds: ["employee-1"],
			}),
		).toEqual({ employeeIds: ["employee-3", "employee-1"], hasScope: true });
	});

	it("leaves admin scope unrestricted when no employees are requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: ["employee-1"],
			}),
		).toEqual({ employeeIds: undefined, hasScope: true });
	});

	it("denies admin scope when an explicit empty employee selection is requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				requestedEmployeeIds: [],
				allowedEmployeeIds: ["employee-1"],
			}),
		).toEqual({ employeeIds: [], hasScope: false });
	});

	it("intersects requested employee IDs with allowed scope for non-admin payroll users", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "manager",
				requestedEmployeeIds: ["employee-3", "employee-1", "employee-2"],
				allowedEmployeeIds: ["employee-1", "employee-2"],
			}),
		).toEqual({ employeeIds: ["employee-1", "employee-2"], hasScope: true });
	});

	it("uses all allowed employee IDs for non-admin payroll users when none are requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "employee",
				allowedEmployeeIds: ["employee-2", "employee-1"],
			}),
		).toEqual({ employeeIds: ["employee-1", "employee-2"], hasScope: true });
	});

	it("denies non-admin payroll scope when requested employees are outside the allowed scope", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "manager",
				requestedEmployeeIds: ["employee-3"],
				allowedEmployeeIds: ["employee-1", "employee-2"],
			}),
		).toEqual({ employeeIds: [], hasScope: false });
	});
});
