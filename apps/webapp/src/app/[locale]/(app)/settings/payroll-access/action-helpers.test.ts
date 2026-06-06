import { describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import {
	assertPayrollOfficerSettingsContext,
	buildValidatedPayrollAccessInput,
} from "./action-helpers";

describe("assertPayrollOfficerSettingsContext", () => {
	it("allows active-org users with CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: true,
				},
				"read",
			),
		).not.toThrow();
	});

	it("allows org admins without an active employee record", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: null,
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: true,
				},
				"read",
			),
		).not.toThrow();
	});

	it("rejects users without CASL manage permission", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
					canManagePayrollOfficerSettings: false,
				},
				"write",
			),
		).toThrow(AuthorizationError);
	});
});

describe("buildValidatedPayrollAccessInput", () => {
	it("allows all scope without specific teams or employees", () => {
		expect(
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-1",
					scope: "all",
					teamIds: [],
					employeeIds: [],
				},
				{
					activeEmployeeIds: ["employee-1"],
					organizationTeamIds: [],
				},
			),
		).toEqual({
			payrollEmployeeId: "employee-1",
			scope: "all",
			teamIds: [],
			employeeIds: [],
		});
	});

	it("rejects specific scope without teams or employees", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-1",
					scope: "specific",
					teamIds: [],
					employeeIds: [],
				},
				{
					activeEmployeeIds: ["employee-1"],
					organizationTeamIds: [],
				},
			),
		).toThrow(ValidationError);
	});
});
