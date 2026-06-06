import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import {
	assertPayrollOfficerSettingsContext,
	buildValidatedPayrollAccessInput,
} from "./action-helpers";

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
	unstable_cache: (callback: unknown) => callback,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/auth-schema", () => ({ user: {} }));
vi.mock("@/db/schema", () => ({
	employee: {},
	payrollAccessEmployee: {},
	payrollAccessGrant: {},
	payrollAccessTeam: {},
	team: {},
}));
vi.mock("@/lib/auth-helpers", () => ({ requireAbility: vi.fn(), requireAuth: vi.fn() }));

describe("payroll access action validation", () => {
	it("rejects contexts without payroll officer settings permission", () => {
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

	it("rejects mismatched active organization contexts", () => {
		expect(() =>
			assertPayrollOfficerSettingsContext(
				{
					userId: "user-1",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-2",
					canManagePayrollOfficerSettings: true,
				},
				"write",
			),
		).toThrow(AuthorizationError);
	});

	it("rejects payroll employees outside the active organization", () => {
		expect(() =>
			buildValidatedPayrollAccessInput(
				{
					payrollEmployeeId: "employee-a",
					scope: "specific",
					teamIds: [],
					employeeIds: [],
				},
				{
					activeEmployeeIds: ["employee-b"],
					organizationTeamIds: [],
				},
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
				{
					activeEmployeeIds: ["employee-a"],
					organizationTeamIds: ["team-ops"],
				},
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
				{
					activeEmployeeIds: ["employee-a"],
					organizationTeamIds: [],
				},
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
				{
					activeEmployeeIds: ["employee-a", "employee-b"],
					organizationTeamIds: ["team-ops"],
				},
			),
		).toEqual({
			payrollEmployeeId: "employee-a",
			scope: "specific",
			teamIds: ["team-ops"],
			employeeIds: ["employee-b"],
		});
	});
});
