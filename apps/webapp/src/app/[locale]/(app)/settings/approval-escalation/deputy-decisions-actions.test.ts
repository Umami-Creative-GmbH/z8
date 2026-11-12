import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@/lib/authorization/types";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	principal: null as PrincipalContext | null,
	saveDeputyDecisionsEnabled: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { ORGANIZATION_ABILITY_QUERY } = await import("@/lib/authorization/organization-ability");
	const { defineAbilityFor } = await import("@/lib/authorization/ability");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { marker: "db" },
			query: (name, fn) =>
				name === ORGANIZATION_ABILITY_QUERY
					? (Effect.sync(() => defineAbilityFor(mocks.principal as PrincipalContext)) as never)
					: Effect.promise(fn),
		}),
	);
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/approvals/approval-settings", () => ({
	saveDeputyDecisionsEnabled: mocks.saveDeputyDecisionsEnabled,
}));

const { saveDeputyDecisionsEnabledAction } = await import("./deputy-decisions-actions");

const workforceAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "admin", former: false },
};

function principal(employeeRole: "admin" | "manager" | "employee"): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: "member" },
		employee: { id: "employee-1", organizationId: "org-1", role: employeeRole, teamId: null },
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	} as PrincipalContext;
}

describe("saveDeputyDecisionsEnabledAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = workforceAdmin;
		mocks.principal = principal("admin");
	});

	it("saves the switch for the active organization as the signed-in user", async () => {
		mocks.saveDeputyDecisionsEnabled.mockResolvedValue({
			changed: true,
			deputyDecisionsEnabled: false,
		});

		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toEqual({
			success: true,
			data: { deputyDecisionsEnabled: false },
		});
		expect(mocks.saveDeputyDecisionsEnabled).toHaveBeenCalledWith(
			{ marker: "db" },
			{ organizationId: "org-1", enabled: false, actorUserId: "user-1" },
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/approval-policies");
	});

	it("refuses an org member who cannot manage approvals", async () => {
		mocks.caller = {
			...workforceAdmin,
			employee: { id: "employee-1", role: "employee", former: false },
		};
		mocks.principal = principal("employee");

		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "You do not have permission to manage approval settings.",
		});
		expect(mocks.saveDeputyDecisionsEnabled).not.toHaveBeenCalled();
	});

	it.each([
		["a pending membership", { ...workforceAdmin, membershipRole: null }],
		[
			"a former employee",
			{ ...workforceAdmin, employee: { id: "employee-1", role: "admin" as const, former: true } },
		],
		["a signed-out caller", null],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		expect(await saveDeputyDecisionsEnabledAction({ enabled: false })).toMatchObject({
			success: false,
		});
		expect(mocks.saveDeputyDecisionsEnabled).not.toHaveBeenCalled();
	});

	it("refuses a value that is not a boolean", async () => {
		expect(await saveDeputyDecisionsEnabledAction({ enabled: "false" } as never)).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid setting",
		});
		expect(mocks.saveDeputyDecisionsEnabled).not.toHaveBeenCalled();
	});
});
