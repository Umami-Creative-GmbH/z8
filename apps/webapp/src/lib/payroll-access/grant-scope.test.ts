import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import {
	buildValidatedPayrollAccessInput,
	diffPayrollAccessScope,
	payrollAccessGrantAuditChanges,
} from "./grant-scope";

describe("buildValidatedPayrollAccessInput", () => {
	it("allows all scope without specific teams or employees", () => {
		expect(
			buildValidatedPayrollAccessInput(
				{ payrollEmployeeId: "employee-1", scope: "all", teamIds: [], employeeIds: [] },
				{ activeEmployeeIds: ["employee-1"], organizationTeamIds: [] },
			),
		).toEqual({ payrollEmployeeId: "employee-1", scope: "all", teamIds: [], employeeIds: [] });
	});

	it("rejects specific scope without teams or employees", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{ payrollEmployeeId: "employee-1", scope: "specific", teamIds: [], employeeIds: [] },
				{ activeEmployeeIds: ["employee-1"], organizationTeamIds: [] },
			),
		).toThrow(ValidationError);
	});

	it("rejects payroll employees outside the active organization", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{ payrollEmployeeId: "employee-a", scope: "specific", teamIds: [], employeeIds: [] },
				{ activeEmployeeIds: ["employee-b"], organizationTeamIds: [] },
			),
		).toThrow(ValidationError);
	});

	it("rejects assigned teams and employees outside the active organization", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: ["team-other"],
					employeeIds: [],
				},
				{ activeEmployeeIds: ["employee-a"], organizationTeamIds: ["team-ops"] },
			),
		).toThrow(ValidationError);

		expect(() =>
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: [],
					employeeIds: ["employee-other"],
				},
				{ activeEmployeeIds: ["employee-a"], organizationTeamIds: [] },
			),
		).toThrow(ValidationError);
	});

	it("deduplicates validated assignment IDs", () => {
		expect(
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: ["team-ops", "team-ops"],
					employeeIds: ["employee-b", "employee-b"],
				},
				{ activeEmployeeIds: ["employee-a", "employee-b"], organizationTeamIds: ["team-ops"] },
			),
		).toEqual({
			payrollEmployeeId: "employee-a",
			scope: "specific",
			teamIds: ["team-ops"],
			employeeIds: ["employee-b"],
		});
	});

	it("keeps a departed employee who is already named on the grant", () => {
		expect(
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: [],
					employeeIds: ["employee-departed"],
				},
				{
					activeEmployeeIds: ["employee-a"],
					organizationTeamIds: [],
					retainedEmployeeIds: ["employee-departed"],
				},
			),
		).toEqual({
			payrollEmployeeId: "employee-a",
			scope: "specific",
			teamIds: [],
			employeeIds: ["employee-departed"],
		});
	});

	it("does not let a departed employee be newly named", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: [],
					employeeIds: ["employee-departed"],
				},
				{ activeEmployeeIds: ["employee-a"], organizationTeamIds: [], retainedEmployeeIds: [] },
			),
		).toThrow(ValidationError);
	});

	it("does not keep a departed payroll officer through retention", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{ payrollEmployeeId: "employee-a", scope: "all", teamIds: [], employeeIds: [] },
				{ activeEmployeeIds: [], organizationTeamIds: [], retainedEmployeeIds: ["employee-a"] },
			),
		).toThrow(ValidationError);
	});
});

describe("diffPayrollAccessScope", () => {
	it("reports no change for the same scope in a different order", () => {
		expect(
			diffPayrollAccessScope(
				{ scope: "specific", teamIds: ["t1", "t2"], employeeIds: ["e1"] },
				{ scope: "specific", teamIds: ["t2", "t1"], employeeIds: ["e1"] },
			),
		).toEqual({
			changed: false,
			addedTeamIds: [],
			removedTeamIds: [],
			addedEmployeeIds: [],
			removedEmployeeIds: [],
		});
	});

	it("lists added and removed teams and employees", () => {
		expect(
			diffPayrollAccessScope(
				{ scope: "specific", teamIds: ["t1", "t2"], employeeIds: ["e1"] },
				{ scope: "specific", teamIds: ["t2", "t3"], employeeIds: ["e2"] },
			),
		).toEqual({
			changed: true,
			addedTeamIds: ["t3"],
			removedTeamIds: ["t1"],
			addedEmployeeIds: ["e2"],
			removedEmployeeIds: ["e1"],
		});
	});

	it("counts a scope switch as a change", () => {
		expect(
			diffPayrollAccessScope(
				{ scope: "specific", teamIds: ["t1"], employeeIds: [] },
				{ scope: "all", teamIds: [], employeeIds: [] },
			),
		).toMatchObject({ changed: true, removedTeamIds: ["t1"] });
	});
});

describe("payrollAccessGrantAuditChanges", () => {
	it("records old and new scope with sorted ids", () => {
		expect(
			payrollAccessGrantAuditChanges(
				{ scope: "specific", teamIds: ["t2", "t1"], employeeIds: ["e1"] },
				{ scope: "all", teamIds: [], employeeIds: [] },
			),
		).toEqual({
			from: { scope: "specific", teamIds: ["t1", "t2"], employeeIds: ["e1"] },
			to: { scope: "all", teamIds: [], employeeIds: [] },
		});
	});

	it("records a missing side as null for create and revoke", () => {
		expect(
			payrollAccessGrantAuditChanges(null, { scope: "all", teamIds: [], employeeIds: [] }),
		).toEqual({ from: null, to: { scope: "all", teamIds: [], employeeIds: [] } });
		expect(
			payrollAccessGrantAuditChanges({ scope: "specific", teamIds: [], employeeIds: ["e1"] }, null),
		).toEqual({ from: { scope: "specific", teamIds: [], employeeIds: ["e1"] }, to: null });
	});
});
