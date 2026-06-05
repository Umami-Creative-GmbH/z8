import { describe, expect, it } from "vitest";
import { resolveScopedPayrollEmployeeIdsForAction } from "./action-helpers";

describe("resolveScopedPayrollEmployeeIdsForAction", () => {
	it("does not give admins global payroll scope", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: [],
			}),
		).toEqual({ employeeIds: [], hasScope: false });
	});

	it("intersects admin requested employees with active grant scope", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "admin",
				allowedEmployeeIds: ["employee-1", "employee-2"],
				requestedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual({ employeeIds: ["employee-2"], hasScope: true });
	});

	it("returns all allowed employees when no filter is requested", () => {
		expect(
			resolveScopedPayrollEmployeeIdsForAction({
				role: "manager",
				allowedEmployeeIds: ["employee-2", "employee-1"],
			}),
		).toEqual({ employeeIds: ["employee-1", "employee-2"], hasScope: true });
	});
});
