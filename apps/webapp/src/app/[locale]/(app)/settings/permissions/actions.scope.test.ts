import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findEmployee: vi.fn(async (): Promise<unknown> => ({ id: "employee-actor" })),
	findEmployees: vi.fn(async (): Promise<unknown[]> => []),
	findTeams: vi.fn(async (): Promise<unknown[]> => []),
	findPermissions: vi.fn(async (): Promise<unknown[]> => []),
	getEmployeePermissions: vi.fn((_employeeId: string, _organizationId: string) => [] as unknown[]),
	hasTeamPermission: vi.fn((..._args: unknown[]) => true),
	grantPermissions: vi.fn(),
	revokePermissions: vi.fn(),
	transaction: vi.fn(),
	formerEmployeeIds: new Set<string>(),
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => mockState.formerEmployeeIds),
);

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { PermissionsService } = await import("@/lib/effect/services/permissions.service");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");

	const query = {
		employee: { findFirst: mockState.findEmployee, findMany: mockState.findEmployees },
		team: { findMany: mockState.findTeams },
		teamPermissions: { findMany: mockState.findPermissions },
	};
	const db = {
		query,
		transaction: mockState.transaction.mockImplementation(
			async (operation: (tx: unknown) => Promise<unknown>) => operation({ query }),
		),
	};

	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mockState.caller, { db }),
			Layer.succeed(
				PermissionsService,
				PermissionsService.of({
					getEmployeePermissions: (employeeId: string, organizationId: string) =>
						Effect.sync(() => mockState.getEmployeePermissions(employeeId, organizationId)),
					hasTeamPermission: (...args: unknown[]) =>
						Effect.sync(() => mockState.hasTeamPermission(...args)),
					grantPermissions: (...args: unknown[]) =>
						Effect.sync(() => mockState.grantPermissions(...args)),
					revokePermissions: (...args: unknown[]) =>
						Effect.sync(() => mockState.revokePermissions(...args)),
				} as never),
			),
		),
	);
});

const {
	getEmployeePermissions,
	grantTeamPermissions,
	hasTeamPermission,
	listEmployeePermissions,
	loadPermissionsPageData,
	revokeTeamPermissions,
} = await import("./actions");

const admin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-actor",
	membershipRole: "admin",
	employee: { id: "employee-admin", role: "employee", former: false },
};
const ownerWithoutEmployee: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-actor",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-actor",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "user-member",
	activeOrganizationId: "org-actor",
	membershipRole: "member",
	employee: { id: "employee-member", role: "employee", former: false },
};

const targetId = "10000000-0000-4000-8000-000000000001";
const teamId = "20000000-0000-4000-8000-000000000001";

describe("permissions settings server scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.caller = admin;
		mockState.formerEmployeeIds = new Set();
		mockState.findEmployee.mockResolvedValue({ id: targetId });
		mockState.findEmployees.mockResolvedValue([
			{ id: "employee-actor", organizationId: "org-actor", userId: "user-actor" },
		]);
		mockState.findTeams.mockResolvedValue([
			{ id: "team-actor", organizationId: "org-actor", name: "Actor Team" },
		]);
		mockState.findPermissions.mockResolvedValue([]);
		mockState.getEmployeePermissions.mockReturnValue([]);
	});

	it.each([
		[
			"grantTeamPermissions",
			() => grantTeamPermissions({ employeeId: targetId, permissions: { canCreateTeams: true } }),
		],
		["revokeTeamPermissions", () => revokeTeamPermissions({ employeeId: targetId })],
		["listEmployeePermissions", () => listEmployeePermissions()],
		["loadPermissionsPageData", () => loadPermissionsPageData()],
	])("refuses %s to a scoped manager, one level below an org admin", async (_name, run) => {
		mockState.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.grantPermissions).not.toHaveBeenCalled();
		expect(mockState.revokePermissions).not.toHaveBeenCalled();
		expect(mockState.findEmployees).not.toHaveBeenCalled();
		expect(mockState.transaction).not.toHaveBeenCalled();
	});

	it("refuses getEmployeePermissions to an org member, one level below a scoped manager", async () => {
		mockState.caller = orgMember;

		expect(await getEmployeePermissions("employee-member")).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.getEmployeePermissions).not.toHaveBeenCalled();
	});

	it("refuses hasTeamPermission to a pending membership, below an org member", async () => {
		mockState.caller = { ...orgMember, membershipRole: null };

		expect(
			await hasTeamPermission({ employeeId: targetId, permission: "canCreateTeams" }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.hasTeamPermission).not.toHaveBeenCalled();
	});

	it("grants in the session's organization with the actor's employee as granter", async () => {
		const result = await grantTeamPermissions({
			employeeId: targetId,
			permissions: { canCreateTeams: true },
			teamId: null,
		});

		expect(result.success).toBe(true);
		expect(mockState.grantPermissions).toHaveBeenCalledWith(
			targetId,
			"org-actor",
			{ canCreateTeams: true },
			null,
			"employee-admin",
		);
	});

	it("refuses an organization ID in the grant input", async () => {
		const result = await grantTeamPermissions({
			employeeId: targetId,
			permissions: { canCreateTeams: true },
			organizationId: "org-attacker",
		} as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.grantPermissions).not.toHaveBeenCalled();
	});

	it("refuses granting a permission to a former employee (#1438)", async () => {
		mockState.formerEmployeeIds = new Set([targetId]);

		const result = await grantTeamPermissions({
			employeeId: targetId,
			permissions: { canManageTeamMembers: true },
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.grantPermissions).not.toHaveBeenCalled();
	});

	it("still clears a former employee's permission flags (#1438)", async () => {
		mockState.formerEmployeeIds = new Set([targetId]);

		const result = await grantTeamPermissions({
			employeeId: targetId,
			permissions: { canManageTeamMembers: false },
		});

		expect(result.success).toBe(true);
		expect(mockState.grantPermissions).toHaveBeenCalled();
	});

	it("needs an employee record to record who granted a permission", async () => {
		mockState.caller = ownerWithoutEmployee;

		const result = await grantTeamPermissions({
			employeeId: targetId,
			permissions: { canCreateTeams: true },
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.grantPermissions).not.toHaveBeenCalled();
	});

	it("revokes in the session's organization", async () => {
		const result = await revokeTeamPermissions({ employeeId: targetId, teamId });

		expect(result.success).toBe(true);
		expect(mockState.revokePermissions).toHaveBeenCalledWith(targetId, "org-actor", teamId);
	});

	it("lets a scoped manager read only their own permissions", async () => {
		mockState.caller = scopedManager;

		expect(await getEmployeePermissions("employee-manager")).toMatchObject({ success: true });
		expect(await getEmployeePermissions("employee-other")).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.getEmployeePermissions).toHaveBeenCalledTimes(1);
		expect(mockState.getEmployeePermissions).toHaveBeenCalledWith("employee-manager", "org-actor");
	});

	it("checks a permission of an employee in the session's organization", async () => {
		mockState.caller = orgMember;

		expect(
			await hasTeamPermission({ employeeId: targetId, permission: "canCreateTeams", teamId }),
		).toEqual({ success: true, data: true });
		expect(mockState.hasTeamPermission).toHaveBeenCalledWith(targetId, "canCreateTeams", teamId);
	});

	it("reports an employee outside the session's organization as not found", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		expect(
			await hasTeamPermission({ employeeId: targetId, permission: "canCreateTeams" }),
		).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.hasTeamPermission).not.toHaveBeenCalled();
	});

	it("lists the session organization's employees with their permissions", async () => {
		const result = await listEmployeePermissions();

		expect(result.success).toBe(true);
		expect(mockState.getEmployeePermissions).toHaveBeenCalledTimes(1);
		expect(mockState.getEmployeePermissions).toHaveBeenCalledWith("employee-actor", "org-actor");
	});

	it("loads one scoped snapshot and returns only public fields", async () => {
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-actor",
				userId: "user-actor",
				organizationId: "org-actor",
				firstName: "private-duplicate",
				lastName: "private-duplicate",
				pronouns: null,
				position: "Developer",
				role: "employee",
				isActive: true,
				teamId: "team-actor",
				user: {
					id: "user-actor",
					firstName: "Ada",
					lastName: "Lovelace",
					name: "Ada Lovelace",
					email: "ada@example.test",
					image: null,
					passwordHash: "secret",
				},
				team: { id: "team-actor", name: "Actor Team", description: "private" },
			},
		]);
		mockState.findTeams.mockResolvedValue([
			{ id: "team-actor", organizationId: "org-actor", name: "Actor Team", description: "private" },
		]);
		mockState.findPermissions.mockResolvedValue([
			{
				id: "permission-private-id",
				employeeId: "employee-actor",
				organizationId: "org-actor",
				teamId: null,
				canCreateTeams: true,
				canManageTeamMembers: false,
				canManageTeamSettings: false,
				canApproveTeamRequests: true,
				grantedBy: "employee-admin",
				grantedAt: new Date("2026-07-29T08:00:00.000Z"),
				createdAt: new Date("2026-07-29T08:00:00.000Z"),
				updatedAt: new Date("2026-07-29T08:00:00.000Z"),
			},
		]);

		const result = await loadPermissionsPageData();

		expect(mockState.transaction).toHaveBeenCalledOnce();
		expect(mockState.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "repeatable read",
		});
		expect(result).toEqual({
			success: true,
			data: {
				organizationId: "org-actor",
				employees: [
					{
						id: "employee-actor",
						userId: "user-actor",
						firstName: "Ada",
						lastName: "Lovelace",
						pronouns: null,
						position: "Developer",
						role: "employee",
						isActive: true,
						teamId: "team-actor",
						user: {
							id: "user-actor",
							firstName: "Ada",
							lastName: "Lovelace",
							name: "Ada Lovelace",
							email: "ada@example.test",
							image: null,
						},
						team: { id: "team-actor", name: "Actor Team" },
					},
				],
				teams: [{ id: "team-actor", organizationId: "org-actor", name: "Actor Team" }],
				permissions: [
					{
						employee: { id: "employee-actor" },
						permissions: [
							{
								employeeId: "employee-actor",
								organizationId: "org-actor",
								teamId: null,
								canCreateTeams: true,
								canManageTeamMembers: false,
								canManageTeamSettings: false,
								canApproveTeamRequests: true,
								grantedBy: "employee-admin",
								grantedAt: new Date("2026-07-29T08:00:00.000Z"),
							},
						],
					},
				],
			},
		});
	});

	it("returns the session organization's identity when all scoped collections are empty", async () => {
		mockState.findEmployees.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);

		expect(await loadPermissionsPageData()).toMatchObject({
			success: true,
			data: { organizationId: "org-actor", employees: [], teams: [], permissions: [] },
		});
	});
});
