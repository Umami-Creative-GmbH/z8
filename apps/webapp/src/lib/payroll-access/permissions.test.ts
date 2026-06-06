import { describe, expect, it } from "vitest";
import {
	intersectPayrollScope,
	type PayrollAccessEmployeeRow,
	type PayrollAccessGrantRow,
	type PayrollAccessTeamMemberRow,
	resolvePayrollAccessibleEmployeeIdsFromRows,
} from "./permissions";

const grant: PayrollAccessGrantRow = {
	id: "grant-1",
	organizationId: "org-1",
	payrollEmployeeId: "payroll-1",
	scope: "specific",
	isActive: true,
};

describe("resolvePayrollAccessibleEmployeeIdsFromRows", () => {
	it("combines direct employees and current team members", () => {
		const directRows: PayrollAccessEmployeeRow[] = [
			{ employeeId: "employee-1", organizationId: "org-1", isActive: true },
		];
		const teamRows: PayrollAccessTeamMemberRow[] = [
			{ employeeId: "employee-2", organizationId: "org-1", isActive: true },
			{ employeeId: "employee-3", organizationId: "org-1", isActive: true },
		];

		expect(resolvePayrollAccessibleEmployeeIdsFromRows({ grant, directRows, teamRows })).toEqual([
			"employee-1",
			"employee-2",
			"employee-3",
		]);
	});

	it("does not include the payroll employee unless explicitly assigned", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [],
				teamRows: [{ employeeId: "employee-2", organizationId: "org-1", isActive: true }],
			}),
		).toEqual(["employee-2"]);
	});

	it("includes the payroll employee when explicitly assigned", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [{ employeeId: "payroll-1", organizationId: "org-1", isActive: true }],
				teamRows: [],
			}),
		).toEqual(["payroll-1"]);
	});

	it("filters inactive and cross-organization employees", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant,
				directRows: [
					{ employeeId: "employee-1", organizationId: "org-1", isActive: false },
					{ employeeId: "employee-2", organizationId: "org-2", isActive: true },
				],
				teamRows: [{ employeeId: "employee-3", organizationId: "org-1", isActive: true }],
			}),
		).toEqual(["employee-3"]);
	});

	it("returns all active organization employees for all scope", () => {
		expect(
			resolvePayrollAccessibleEmployeeIdsFromRows({
				grant: { ...grant, scope: "all" },
				directRows: [],
				teamRows: [],
				allEmployeeRows: [
					{ employeeId: "employee-1", organizationId: "org-1", isActive: true },
					{ employeeId: "employee-2", organizationId: "org-1", isActive: false },
					{ employeeId: "employee-3", organizationId: "org-2", isActive: true },
				],
			}),
		).toEqual(["employee-1"]);
	});
});

describe("intersectPayrollScope", () => {
	it("intersects requested employee ids with the allowed set", () => {
		expect(
			intersectPayrollScope({
				allowedEmployeeIds: ["employee-1", "employee-2"],
				requestedEmployeeIds: ["employee-2", "employee-3"],
			}),
		).toEqual(["employee-2"]);
	});

	it("returns all allowed employees when no employee filter is requested", () => {
		expect(
			intersectPayrollScope({
				allowedEmployeeIds: ["employee-1", "employee-2"],
			}),
		).toEqual(["employee-1", "employee-2"]);
	});
});
