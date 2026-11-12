import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import { buildValidatedPayrollAccessInput } from "@/lib/payroll-access/grant-scope";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	transaction: vi.fn(),
	select: vi.fn(),
	savePayrollAccessGrant: vi.fn(),
	revokePayrollAccessGrant: vi.fn(),
	currentRosterAmong: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
	unstable_cache: (callback: unknown) => callback,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { transaction: mocks.transaction, select: mocks.select },
		}),
	);
});

vi.mock("@/lib/employee-lifecycle/current-roster-among", () => ({
	currentRosterAmong: mocks.currentRosterAmong,
}));

vi.mock("@/lib/payroll-access/grant-store", () => ({
	savePayrollAccessGrant: mocks.savePayrollAccessGrant,
	revokePayrollAccessGrant: mocks.revokePayrollAccessGrant,
}));

const { getPayrollAccessAdminDataAction, revokePayrollAccessGrantAction, savePayrollAccessAction } =
	await import("./actions");

const officerId = "d7490000-0000-4000-8000-000000000002";
const grant = {
	payrollEmployeeId: officerId,
	scope: "specific" as const,
	teamIds: [],
	employeeIds: ["d7490000-0000-4000-8000-000000000003"],
};

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-admin", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work("tx"));
	mocks.currentRosterAmong.mockImplementation(async (_db, _org, ids: string[]) => new Set(ids));
	mocks.savePayrollAccessGrant.mockResolvedValue({ grantId: "grant-1", outcome: "created" });
	mocks.revokePayrollAccessGrant.mockResolvedValue({ grantId: "grant-1" });
});

describe("payroll access settings actions", () => {
	it("saves a grant in the session's organization for the caller", async () => {
		const result = await savePayrollAccessAction(grant);

		expect(result).toEqual({ success: true, data: { grantId: "grant-1" } });
		expect(mocks.savePayrollAccessGrant).toHaveBeenCalledWith("tx", {
			organizationId: "org-1",
			actorUserId: "user-admin",
			grant,
		});
	});

	it("revokes a grant in the session's organization", async () => {
		const result = await revokePayrollAccessGrantAction({ grantId: "grant-1" });

		expect(result).toEqual({ success: true, data: { grantId: "grant-1" } });
		expect(mocks.revokePayrollAccessGrant).toHaveBeenCalledWith("tx", {
			organizationId: "org-1",
			actorUserId: "user-admin",
			grantId: "grant-1",
		});
	});

	it("keeps the grant store's typed refusal", async () => {
		mocks.revokePayrollAccessGrant.mockRejectedValue(
			new ValidationError({ message: "Payroll access grant is not active" }),
		);

		expect(await revokePayrollAccessGrantAction({ grantId: "grant-1" })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Payroll access grant is not active",
		});
	});

	it("refuses a former employee as the payroll officer before saving", async () => {
		mocks.currentRosterAmong.mockResolvedValue(new Set());

		expect(await savePayrollAccessAction(grant)).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "former_employee",
		});
		expect(mocks.savePayrollAccessGrant).not.toHaveBeenCalled();
	});

	it("rejects malformed input before saving", async () => {
		expect(await savePayrollAccessAction({ ...grant, scope: "teams" } as never)).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(mocks.savePayrollAccessGrant).not.toHaveBeenCalled();
	});

	it.each([
		["a scoped manager", scopedManager],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		[
			"a former employee",
			{ ...orgAdmin, employee: { id: "employee-admin", role: "admin" as const, former: true } },
		],
		["a signed-out caller", null],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		for (const result of [
			await getPayrollAccessAdminDataAction(),
			await savePayrollAccessAction(grant),
			await revokePayrollAccessGrantAction({ grantId: "grant-1" }),
		]) {
			expect(result).toMatchObject({ success: false });
		}
		expect(mocks.select).not.toHaveBeenCalled();
		expect(mocks.savePayrollAccessGrant).not.toHaveBeenCalled();
		expect(mocks.revokePayrollAccessGrant).not.toHaveBeenCalled();
	});
});

describe("payroll access grant validation", () => {
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
});
