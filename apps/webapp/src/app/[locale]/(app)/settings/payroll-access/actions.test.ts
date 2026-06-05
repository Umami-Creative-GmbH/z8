import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import {
	assertPayrollAccessAdminContext,
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
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }));

describe("payroll access action validation", () => {
	it("rejects non-admin employee contexts", () => {
		expect(() =>
			assertPayrollAccessAdminContext(
				{
					userId: "user-1",
					role: "manager",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-1",
				},
				"write",
			),
		).toThrow(AuthorizationError);
	});

	it("rejects mismatched active organization contexts", () => {
		expect(() =>
			assertPayrollAccessAdminContext(
				{
					userId: "user-1",
					role: "admin",
					employeeOrganizationId: "org-1",
					activeOrganizationId: "org-2",
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
			teamIds: ["team-ops"],
			employeeIds: ["employee-b"],
		});
	});
});
