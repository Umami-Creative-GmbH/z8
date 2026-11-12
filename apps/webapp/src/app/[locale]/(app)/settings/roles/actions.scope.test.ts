import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	listRoles: vi.fn(),
	createRole: vi.fn(),
	assignRole: vi.fn(),
	rosterFindMany: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { CustomRoleService } = await import("@/lib/effect/services/custom-role.service");
	const call =
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			Effect.promise(async () => fn(...args));

	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mocks.caller, {
				db: { query: { employee: { findMany: mocks.rosterFindMany } } },
			}),
			Layer.succeed(CustomRoleService, {
				listRoles: call(mocks.listRoles),
				createRole: call(mocks.createRole),
				assignRole: call(mocks.assignRole),
				getRole: vi.fn(),
				updateRole: vi.fn(),
				deleteRole: vi.fn(),
				setPermissions: vi.fn(),
				unassignRole: vi.fn(),
				getEmployeeRoles: vi.fn(),
			} as never),
		),
	);
});

const { assignRoleToEmployee, createCustomRole, listCustomRoles } = await import("./actions");

const ownerWithoutEmployee: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};

describe("custom role settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = ownerWithoutEmployee;
		mocks.listRoles.mockResolvedValue([]);
		mocks.createRole.mockResolvedValue("role-1");
		mocks.assignRole.mockResolvedValue(undefined);
	});

	it("lets an owner without an employee record list the active organization's roles", async () => {
		mocks.listRoles.mockResolvedValue([{ id: "role-1" }]);

		const result = await listCustomRoles();

		expect(result).toEqual({ success: true, data: [{ id: "role-1" }] });
		expect(mocks.listRoles).toHaveBeenCalledWith("org-1");
	});

	it("creates a role in the active organization for the caller", async () => {
		const input = { name: "Supervisor", baseTier: "manager" as const };

		const result = await createCustomRole(input);

		expect(result).toEqual({ success: true, data: { id: "role-1" } });
		expect(mocks.createRole).toHaveBeenCalledWith("org-1", input, "user-owner");
	});

	it.each([
		["a scoped manager", scopedManager],
		["a pending membership", { ...ownerWithoutEmployee, membershipRole: null }],
		[
			"a former employee",
			{
				...ownerWithoutEmployee,
				employee: { id: "employee-owner", role: "admin" as const, former: true },
			},
		],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		expect(await listCustomRoles()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(await createCustomRole({ name: "X", baseTier: "employee" })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await assignRoleToEmployee({ employeeId: "employee-1", roleId: "role-1" }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.listRoles).not.toHaveBeenCalled();
		expect(mocks.createRole).not.toHaveBeenCalled();
		expect(mocks.assignRole).not.toHaveBeenCalled();
	});

	it("rejects a role without a base tier before creating it", async () => {
		const result = await createCustomRole({ name: "Supervisor" } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.createRole).not.toHaveBeenCalled();
	});
});
