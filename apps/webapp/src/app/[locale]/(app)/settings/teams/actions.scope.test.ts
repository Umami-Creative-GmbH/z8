import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	employeeQueue: [] as Array<any>,
	teamQueue: [] as Array<any>,
	teamMembershipRows: [] as Array<any>,
	teamPermissionsRows: [] as Array<any>,
	hasTeamPermission: vi.fn(async (..._args: unknown[]) => false),
	revalidateTag: vi.fn(),
	onTeamMemberAdded: vi.fn(),
	onTeamMemberRemoved: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(async () => undefined),
	insertReturning: vi.fn(async (): Promise<any[]> => []),
	updateSet: vi.fn(),
	updateWhere: vi.fn(async () => undefined),
	deleteWhere: vi.fn(async () => undefined),
	teamMembershipFindFirst: vi.fn(async () => null),
	formerEmployeeIds: new Set<string>(),
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => mockState.formerEmployeeIds),
);

// Protection is covered by authorization-mutation.test.ts and the PostgreSQL
// suite; here the mutation runs against the fake database.
vi.mock("@/lib/authorization/authorization-mutation", () => ({
	withAuthorizationMutation: async (
		_scope: unknown,
		mutation: (tx: unknown) => Promise<unknown>,
		database: unknown,
	) => mutation(database),
}));

// Ending driving authorizations on a primary-team change (#1425) is covered by the
// driving licence PostgreSQL suite; here the team write runs on its own.
vi.mock("@/lib/organization/driving-licence/no-longer-intended", () => ({
	runDrivingLicenceIntendedDriverWrite: (
		tx: unknown,
		_scope: unknown,
		write: (tx: unknown) => Promise<unknown>,
	) => write(tx),
	previewDrivingLicenceIntendedDriverWrite: async () => [],
}));

vi.mock("next/cache", () => ({
	revalidateTag: mockState.revalidateTag,
}));

// The roster rule itself is covered by the PostgreSQL suites (#1438); here a
// member is current unless the test lists them as former.
vi.mock("@/lib/employee-lifecycle/current-roster-among", () => ({
	currentRosterAmong: vi.fn(
		async (_db: unknown, _organizationId: string, employeeIds: Iterable<string>) =>
			new Set([...employeeIds].filter((id) => !mockState.formerEmployeeIds.has(id))),
	),
	// Former members left on a recorded date unless the test leaves it out.
	formerEmployeesAmong: vi.fn(
		async (_db: unknown, _organizationId: string, employeeIds: Iterable<string>) =>
			new Map(
				[...employeeIds]
					.filter((id) => mockState.formerEmployeeIds.has(id))
					.map((id) => [id, "2026-10-12"] as const),
			),
	),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onTeamMemberAdded: mockState.onTeamMemberAdded,
	onTeamMemberRemoved: mockState.onTeamMemberRemoved,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { PermissionsService } = await import("@/lib/effect/services/permissions.service");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");

	const db = {
		query: {
			employee: {
				findFirst: vi.fn(async () => mockState.employeeQueue.shift() ?? null),
				findMany: vi.fn(async () => mockState.employeeQueue.shift() ?? []),
			},
			team: {
				findFirst: vi.fn(async () => mockState.teamQueue.shift() ?? null),
				findMany: vi.fn(async () => mockState.teamQueue.shift() ?? []),
			},
			teamMembership: {
				findFirst: mockState.teamMembershipFindFirst,
				findMany: vi.fn(async () => mockState.teamMembershipRows.shift() ?? []),
			},
			teamPermissions: {
				findMany: vi.fn(async () => mockState.teamPermissionsRows),
			},
			user: { findFirst: vi.fn(async () => ({ name: "Caller" })) },
		},
		insert: vi.fn(() => ({ values: mockState.insertValues })),
		update: vi.fn(() => ({ set: mockState.updateSet })),
		delete: vi.fn(() => ({ where: mockState.deleteWhere })),
	};

	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mockState.caller, { db }),
			Layer.succeed(
				PermissionsService,
				PermissionsService.of({
					hasTeamPermission: (...args: unknown[]) =>
						Effect.promise(() => mockState.hasTeamPermission(...args)),
				} as never),
			),
		),
	);
});

const {
	addTeamMember,
	createTeam,
	deleteTeam,
	getTeam,
	listTeams,
	previewTeamDeletionDrivingImpact,
	previewTeamMemberChangeDrivingImpact,
	removeTeamMember,
	updateTeam,
} = await import("./actions");

const admin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "admin-1", role: "admin", former: false },
};
const ownerWithoutEmployee: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-manager", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-1", role: "employee", former: false },
};

function scopedMemberPermission(teamId: string) {
	return {
		id: "perm-1",
		employeeId: "emp-manager",
		organizationId: "org-1",
		teamId,
		canCreateTeams: false,
		canManageTeamMembers: true,
		canManageTeamSettings: false,
		canApproveTeamRequests: false,
	};
}

describe("team settings server scope", () => {
	const employeePrimaryManagerId = "11111111-1111-4111-8111-111111111111";
	const managerPrimaryManagerId = "22222222-2222-4222-8222-222222222222";
	const adminPrimaryManagerId = "33333333-3333-4333-8333-333333333333";
	const foreignPrimaryManagerId = "44444444-4444-4444-8444-444444444444";

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.caller = admin;
		mockState.employeeQueue = [];
		mockState.teamQueue = [];
		mockState.teamMembershipRows = [];
		mockState.teamPermissionsRows = [];
		mockState.hasTeamPermission.mockResolvedValue(false);
		mockState.insertValues.mockImplementation(() => ({
			onConflictDoNothing: mockState.onConflictDoNothing,
			returning: mockState.insertReturning,
		}));
		mockState.onConflictDoNothing.mockResolvedValue(undefined);
		mockState.insertReturning.mockResolvedValue([]);
		mockState.updateSet.mockImplementation(() => ({ where: mockState.updateWhere }));
		mockState.teamMembershipFindFirst.mockResolvedValue(null);
		mockState.formerEmployeeIds = new Set();
	});

	it.each([
		["listTeams", () => listTeams()],
		["getTeam", () => getTeam("team-a")],
		["updateTeam", () => updateTeam({ teamId: "team-a", name: "Alpha" })],
		["deleteTeam", () => deleteTeam({ teamId: "team-a" })],
		["addTeamMember", () => addTeamMember({ teamId: "team-a", employeeId: "target-1" })],
		["removeTeamMember", () => removeTeamMember({ teamId: "team-a", employeeId: "target-1" })],
		[
			"previewTeamMemberChangeDrivingImpact",
			() =>
				previewTeamMemberChangeDrivingImpact({
					teamId: "team-a",
					employeeId: "target-1",
					change: "add",
				}),
		],
		["previewTeamDeletionDrivingImpact", () => previewTeamDeletionDrivingImpact("team-a")],
	])("refuses %s to an org member, one level below a scoped manager", async (_name, run) => {
		mockState.caller = orgMember;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.teamPermissionsRows = [
			{ ...scopedMemberPermission("team-a"), employeeId: "emp-1", canManageTeamSettings: true },
		];
		mockState.hasTeamPermission.mockResolvedValue(true);

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("refuses adding a former employee to a team (#1438)", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.formerEmployeeIds = new Set(["target-1"]);

		const result = await addTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("refuses team creation to a scoped manager, one level below an org admin, even with canCreateTeams", async () => {
		mockState.caller = scopedManager;
		mockState.hasTeamPermission.mockResolvedValue(true);

		const result = await createTeam({ name: "Gamma", description: null });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertReturning).not.toHaveBeenCalled();
	});

	it("allows owners without an employee record to create teams", async () => {
		mockState.caller = ownerWithoutEmployee;
		mockState.insertReturning.mockResolvedValue([
			{ id: "team-new", organizationId: "org-1", name: "Gamma", description: null },
		]);

		const result = await createTeam({ name: "Gamma", description: null });

		expect(result).toEqual({
			success: true,
			data: { id: "team-new", organizationId: "org-1", name: "Gamma", description: null },
		});
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
	});

	it("refuses an organization ID in the team creation input", async () => {
		const result = await createTeam({
			organizationId: "org-other",
			name: "Gamma",
		} as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("allows organization admins to create a team with a primary manager", async () => {
		mockState.employeeQueue = [
			{
				id: managerPrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "manager",
				isActive: true,
			},
		];
		mockState.insertReturning.mockResolvedValue([
			{
				id: "team-new",
				organizationId: "org-1",
				name: "Gamma",
				description: null,
				primaryManagerId: managerPrimaryManagerId,
			},
		]);

		const result = await createTeam({
			name: "Gamma",
			description: null,
			primaryManagerId: managerPrimaryManagerId,
		});

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: managerPrimaryManagerId }),
		);
	});

	it("refuses a former employee as a new team's primary manager (#1438)", async () => {
		mockState.formerEmployeeIds = new Set([managerPrimaryManagerId]);

		const result = await createTeam({ name: "Gamma", primaryManagerId: managerPrimaryManagerId });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager reading a team they have no permission on", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.teamPermissionsRows = [scopedMemberPermission("team-b")];

		const result = await getTeam("team-a");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("reads a team as a scoped manager with member permission on it", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.teamPermissionsRows = [scopedMemberPermission("team-a")];

		const result = await getTeam("team-a");

		expect(result).toMatchObject({
			success: true,
			data: { id: "team-a", canManageMembers: true, canManageSettings: false },
		});
	});

	it("reports another organization's team as not found", async () => {
		mockState.teamQueue = [null];

		expect(await getTeam("team-elsewhere")).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("allows owners without an employee record to read teams", async () => {
		mockState.caller = ownerWithoutEmployee;
		mockState.teamQueue = [
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				employees: [],
			},
		];

		const result = await getTeam("team-a");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.canManageMembers).toBe(true);
			expect(result.data.canManageSettings).toBe(true);
		}
	});

	it("maps getTeam employees from team memberships for UI compatibility", async () => {
		mockState.caller = ownerWithoutEmployee;
		mockState.teamQueue = [
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				memberships: [
					{
						teamId: "team-a",
						employeeId: "target-1",
						employee: {
							id: "target-1",
							userId: "user-2",
							organizationId: "org-1",
							teamId: "team-b",
							user: { id: "user-2", name: "Target" },
						},
					},
				],
			},
		];

		const result = await getTeam("team-a");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.employees).toEqual([
				expect.objectContaining({
					id: "target-1",
					user: { id: "user-2", name: "Target" },
					isFormer: false,
				}),
			]);
		}
	});

	it("marks former team members so the page can hide them (#1438)", async () => {
		mockState.caller = ownerWithoutEmployee;
		mockState.formerEmployeeIds = new Set(["former-1"]);
		mockState.teamQueue = [
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				memberships: ["current-1", "former-1"].map((id) => ({
					teamId: "team-a",
					employeeId: id,
					employee: {
						id,
						userId: `user-${id}`,
						organizationId: "org-1",
						user: { id: `user-${id}` },
					},
				})),
			},
		];

		const result = await getTeam("team-a");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(
				result.data.employees?.map((member) => ({
					id: member.id,
					isFormer: member.isFormer,
					formerSince: member.formerSince,
				})),
			).toEqual([
				{ id: "current-1", isFormer: false, formerSince: undefined },
				{ id: "former-1", isFormer: true, formerSince: "2026-10-12" },
			]);
			expect(result.data.employees?.[0]).not.toHaveProperty("formerSince");
		}
	});

	it("lists teams with employees mapped from memberships for UI compatibility", async () => {
		mockState.caller = ownerWithoutEmployee;
		mockState.teamQueue = [
			[
				{
					id: "team-a",
					organizationId: "org-1",
					name: "Alpha",
					description: null,
					createdAt: new Date(),
					updatedAt: new Date(),
					memberships: [
						{
							teamId: "team-a",
							employeeId: "target-1",
							employee: {
								id: "target-1",
								userId: "user-2",
								organizationId: "org-1",
								teamId: null,
								user: { id: "user-2", name: "Target" },
							},
						},
					],
				},
			],
		];

		const result = await listTeams();

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(1);
			expect(result.data[0]?.employees).toEqual([
				expect.objectContaining({ id: "target-1", user: { id: "user-2", name: "Target" } }),
			]);
		}
	});

	it("lists only the teams a scoped manager may manage", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [
			[
				{ id: "team-a", organizationId: "org-1", name: "Alpha", memberships: [] },
				{ id: "team-b", organizationId: "org-1", name: "Beta", memberships: [] },
			],
		];
		mockState.teamPermissionsRows = [scopedMemberPermission("team-b")];

		const result = await listTeams();

		expect(result).toMatchObject({ success: true, data: [{ id: "team-b" }] });
		expect(result.success && result.data).toHaveLength(1);
	});

	it("blocks deleting a team when team memberships exist", async () => {
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.teamMembershipRows = [
			[{ organizationId: "org-1", teamId: "team-a", employeeId: "target-1" }],
		];

		const result = await deleteTeam({ teamId: "team-a" });

		expect(result.success).toBe(false);
		expect(result.success ? null : result.error).toBe(
			"Cannot delete team with active members. Please reassign members first.",
		);
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager deleting a team without settings permission", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];

		const result = await deleteTeam({ teamId: "team-a" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.hasTeamPermission).toHaveBeenCalledWith(
			"emp-manager",
			"canManageTeamSettings",
			"team-a",
		);
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("rejects adding a member from an out-of-scope team", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.employeeQueue = [
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-b",
				user: { name: "Target" },
			},
		];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [scopedMemberPermission("team-a")];

		const result = await addTeamMember({ teamId: "team-a", employeeId: "emp-target" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.updateWhere).not.toHaveBeenCalled();
	});

	it("adds team membership without moving an employee out of another team", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await addTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-b",
				employeeId: "target-1",
				organizationId: "org-1",
				createdBy: "user-1",
			}),
		);
		expect(mockState.updateSet).not.toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team-b" }),
		);
		expect(mockState.revalidateTag).toHaveBeenCalledWith("teams:org-1", "max");
		expect(mockState.revalidateTag).toHaveBeenCalledWith("employees:org-1", "max");
		expect(mockState.onTeamMemberAdded).toHaveBeenCalledWith(
			expect.objectContaining({ performedByName: "Caller", organizationId: "org-1" }),
		);
	});

	it("adds team membership and sets compatibility team when employee has none", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await addTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-b",
				employeeId: "target-1",
				organizationId: "org-1",
			}),
		);
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-b" }));
	});

	it("rejects scoped manager adding employee with existing membership outside scope", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.employeeQueue = [
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { name: "Target" },
			},
		];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [scopedMemberPermission("team-b")];
		mockState.teamMembershipRows = [
			[{ organizationId: "org-1", teamId: "team-a", employeeId: "emp-target" }],
		];

		const result = await addTeamMember({ teamId: "team-b", employeeId: "emp-target" });

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "Cannot move employees from teams outside your scope",
		});
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("allows scoped manager adding employee with no memberships and no legacy team", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.employeeQueue = [
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { name: "Target" },
			},
		];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [scopedMemberPermission("team-b")];
		mockState.teamMembershipRows = [[]];

		const result = await addTeamMember({ teamId: "team-b", employeeId: "emp-target" });

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-b",
				employeeId: "emp-target",
				organizationId: "org-1",
			}),
		);
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-b" }));
	});

	it("uses idempotent insert for duplicate team membership adds", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await addTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.onConflictDoNothing).toHaveBeenCalledOnce();
	});

	it("removes only selected team membership and reassigns compatibility team to another remaining membership", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-b",
				user: { name: "Target" },
			},
			{ teamId: "team-b" },
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.teamMembershipRows = [
			[
				{ organizationId: "org-1", teamId: "team-c", employeeId: "target-1" },
				{ organizationId: "org-1", teamId: "team-a", employeeId: "target-1" },
			],
		];

		const result = await removeTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.deleteWhere).toHaveBeenCalled();
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-a" }));
		expect(mockState.revalidateTag).toHaveBeenCalledWith("teams:org-1", "max");
		expect(mockState.revalidateTag).toHaveBeenCalledWith("employees:org-1", "max");
	});

	it("removes only selected team membership without changing a different compatibility team", async () => {
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { name: "Target" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await removeTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.deleteWhere).toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ teamId: null }));
	});

	it("still removes a former employee from a team (#1438)", async () => {
		mockState.formerEmployeeIds = new Set(["target-1"]);
		mockState.employeeQueue = [
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { name: "Target" },
			},
		];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await removeTeamMember({ teamId: "team-b", employeeId: "target-1" });

		expect(result.success).toBe(true);
		expect(mockState.deleteWhere).toHaveBeenCalled();
	});

	it("rejects primary manager assignment for employee role", async () => {
		mockState.employeeQueue = [
			{
				id: employeePrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				isActive: true,
			},
		];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam({
			teamId: "team-a",
			primaryManagerId: employeePrimaryManagerId,
		});

		expect(result.success ? null : result.error).toBe(
			"Primary manager must be an active manager or admin in this organization",
		);
	});

	it("refuses a scoped manager updating a team without settings permission", async () => {
		mockState.caller = scopedManager;
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];

		const result = await updateTeam({ teamId: "team-a", name: "Renamed" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("clears primary manager assignment", async () => {
		mockState.teamQueue = [
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				primaryManagerId: managerPrimaryManagerId,
			},
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam({ teamId: "team-a", primaryManagerId: null });

		expect(result.success).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: null }),
		);
	});

	it.each([
		["manager", managerPrimaryManagerId],
		["admin", adminPrimaryManagerId],
	])("allows active %s primary manager assignment", async (role, primaryManagerId) => {
		mockState.employeeQueue = [
			{ id: primaryManagerId, userId: "user-2", organizationId: "org-1", role, isActive: true },
		];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId },
		];

		const result = await updateTeam({ teamId: "team-a", primaryManagerId });

		expect(result.success).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ primaryManagerId }));
	});

	it("rejects inactive or cross-org primary manager assignment", async () => {
		mockState.employeeQueue = [null];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam({
			teamId: "team-a",
			primaryManagerId: foreignPrimaryManagerId,
		});

		expect(result.success ? null : result.error).toBe(
			"Primary manager must be an active manager or admin in this organization",
		);
	});
});
