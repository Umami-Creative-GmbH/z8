import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const session = {
		user: {
			id: "user-1",
			email: "user@example.com",
			name: "User",
		},
	};

	return {
		session,
		employeeQueue: [] as Array<any>,
		membershipQueue: [] as Array<any>,
		teamQueue: [] as Array<any>,
		teamMembershipRows: [] as Array<any>,
		teamPermissionsRows: [] as Array<any>,
		hasTeamPermission: vi.fn(async () => false),
		revalidateTag: vi.fn(),
		loggerInfo: vi.fn(),
		loggerError: vi.fn(),
		onTeamMemberAdded: vi.fn(),
		onTeamMemberRemoved: vi.fn(),
		insertValues: vi.fn(async () => undefined),
		onConflictDoNothing: vi.fn(async () => undefined),
		insertReturning: vi.fn(async () => []),
		updateSet: vi.fn(() => undefined),
		updateWhere: vi.fn(async () => undefined),
		deleteWhere: vi.fn(async () => undefined),
		teamMembershipFindFirst: vi.fn(async () => null),
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("next/cache", () => ({
	revalidateTag: mockState.revalidateTag,
}));

vi.mock("@opentelemetry/api", () => ({
	SpanStatusCode: { OK: 1, ERROR: 2 },
	trace: {
		getTracer: vi.fn(() => ({
			startActiveSpan: (_name: string, _options: unknown, callback: (span: any) => unknown) =>
				callback({
					setAttribute: vi.fn(),
					setStatus: vi.fn(),
					recordException: vi.fn(),
					end: vi.fn(),
				}),
		})),
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		userId: "userId",
		organizationId: "organizationId",
		id: "id",
		teamId: "teamId",
		isActive: "isActive",
		role: "role",
	},
	team: {
		id: "id",
		organizationId: "organizationId",
		name: "name",
		primaryManagerId: "primaryManagerId",
		$inferSelect: {},
	},
	teamMembership: {
		organizationId: "organizationId",
		teamId: "teamId",
		employeeId: "employeeId",
		createdBy: "createdBy",
	},
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		$inferSelect: {},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "userId", organizationId: "organizationId", role: "role" },
}));

vi.mock("@/lib/cache/tags", () => ({
	CACHE_TAGS: {
		TEAMS: (organizationId: string) => `teams:${organizationId}`,
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: mockState.loggerInfo,
		error: mockState.loggerError,
	}),
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onTeamMemberAdded: mockState.onTeamMemberAdded,
	onTeamMemberRemoved: mockState.onTeamMemberRemoved,
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<{ readonly getSession: () => unknown }>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.GenericTag<{
		readonly db: {
			query: {
				employee: {
					findFirst: (input: unknown) => Promise<any>;
					findMany: (input: unknown) => Promise<any[]>;
				};
				member: { findFirst: (input: unknown) => Promise<any> };
				team: {
					findFirst: (input: unknown) => Promise<any>;
					findMany: (input: unknown) => Promise<any[]>;
				};
				teamMembership: {
					findFirst: (input: unknown) => Promise<any>;
					findMany: (input: unknown) => Promise<any[]>;
				};
				teamPermissions: { findMany: (input: unknown) => Promise<any[]> };
			};
			insert: (table: unknown) => {
				values: (input: unknown) => {
					onConflictDoNothing: () => Promise<void>;
					returning: () => Promise<any[]>;
				};
			};
			update: (table: unknown) => {
				set: (input: unknown) => { where: (input: unknown) => Promise<void> };
			};
			delete: (table: unknown) => { where: (input: unknown) => Promise<void> };
		};
		readonly query: <T>(key: string, fn: () => Promise<T>) => unknown;
	}>("DatabaseService");
	return { DatabaseService };
});

vi.mock("@/lib/effect/services/permissions.service", async () => {
	const { Context } = await import("effect");
	const PermissionsService = Context.GenericTag<{
		readonly hasTeamPermission: (...args: unknown[]) => unknown;
	}>("PermissionsService");
	return { PermissionsService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");
	const { PermissionsService } = await import("@/lib/effect/services/permissions.service");

	const authLayer = Layer.succeed(AuthService, {
		getSession: () => Effect.succeed(mockState.session),
	});

	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				employee: {
					findFirst: vi.fn(async () => mockState.employeeQueue.shift() ?? null),
					findMany: vi.fn(async () => mockState.employeeQueue.shift() ?? []),
				},
				member: {
					findFirst: vi.fn(async () => mockState.membershipQueue.shift() ?? null),
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
			},
			insert: vi.fn(() => ({
				values: mockState.insertValues.mockImplementation(() => ({
					onConflictDoNothing: mockState.onConflictDoNothing,
					returning: mockState.insertReturning,
				})),
			})),
			update: vi.fn(() => ({
				set: mockState.updateSet.mockImplementation(() => ({ where: mockState.updateWhere })),
			})),
			delete: vi.fn(() => ({ where: mockState.deleteWhere })),
		},
		query: <T>(_key: string, fn: () => Promise<T>) => Effect.promise(fn),
	});

	const permissionsLayer = Layer.succeed(PermissionsService, {
		hasTeamPermission: (...args: unknown[]) =>
			Effect.promise(() => mockState.hasTeamPermission(...args)),
	});

	return {
		AppLayer: Layer.mergeAll(authLayer, databaseLayer, permissionsLayer),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = (exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error && typeof error === "object" && "_tag" in error) {
					return {
						success: false as const,
						error: (error as { message: string }).message,
						code: (error as { _tag: string })._tag,
					};
				}

				return {
					success: false as const,
					error: error instanceof Error ? error.message : "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			},
			onSuccess: (data) => ({ success: true as const, data }),
		});

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromiseExit<T>>[0]) => {
			const exit = await Effect.runPromiseExit(effect);
			return toServerActionResult(exit);
		},
	};
});

const { addTeamMember, createTeam, deleteTeam, getTeam, listTeams, removeTeamMember, updateTeam } =
	await import("./actions");

describe("team settings server scope", () => {
	const employeePrimaryManagerId = "11111111-1111-4111-8111-111111111111";
	const managerPrimaryManagerId = "22222222-2222-4222-8222-222222222222";
	const adminPrimaryManagerId = "33333333-3333-4333-8333-333333333333";
	const foreignPrimaryManagerId = "44444444-4444-4444-8444-444444444444";

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.employeeQueue = [];
		mockState.membershipQueue = [];
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
	});

	it("rejects manager team creation even when canCreateTeams is granted", async () => {
		mockState.employeeQueue = [
			{ id: "emp-1", userId: "user-1", organizationId: "org-1", role: "manager", teamId: "team-a" },
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "member" }];
		mockState.hasTeamPermission.mockResolvedValue(true);

		const result = await createTeam({
			organizationId: "org-1",
			name: "Gamma",
			description: null,
		});

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
		expect(mockState.insertReturning).not.toHaveBeenCalled();
	});

	it("allows owners without an admin employee row to create teams", async () => {
		mockState.employeeQueue = [null];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "owner" }];
		mockState.insertReturning.mockResolvedValue([
			{ id: "team-new", organizationId: "org-1", name: "Gamma", description: null },
		]);

		const result = await createTeam({
			organizationId: "org-1",
			name: "Gamma",
			description: null,
		});

		expect(result).toEqual({
			success: true,
			data: { id: "team-new", organizationId: "org-1", name: "Gamma", description: null },
		});
	});

	it("allows organization admins to create a team with a primary manager", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: managerPrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "manager",
				isActive: true,
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
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
			organizationId: "org-1",
			name: "Gamma",
			description: null,
			primaryManagerId: managerPrimaryManagerId,
		});

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: managerPrimaryManagerId }),
		);
	});

	it("rejects non-manager employees from reading scoped team settings even with team permissions", async () => {
		mockState.employeeQueue = [
			{
				id: "emp-1",
				userId: "user-1",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
			},
		];
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
		mockState.teamPermissionsRows = [
			{
				id: "perm-1",
				employeeId: "emp-1",
				organizationId: "org-1",
				teamId: "team-a",
				canCreateTeams: false,
				canManageTeamMembers: true,
				canManageTeamSettings: true,
				canApproveTeamRequests: false,
			},
		];

		const result = await getTeam("team-a");

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
	});

	it("allows owners without an admin employee row to read teams", async () => {
		mockState.employeeQueue = [null];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "owner" }];
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
		mockState.employeeQueue = [null];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "owner" }];
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
				expect.objectContaining({ id: "target-1", user: { id: "user-2", name: "Target" } }),
			]);
		}
	});

	it("lists teams with employees mapped from memberships for UI compatibility", async () => {
		mockState.employeeQueue = [null, null];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "owner" }];
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

		const result = await listTeams("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toHaveLength(1);
			expect(result.data[0]?.employees).toEqual([
				expect.objectContaining({ id: "target-1", user: { id: "user-2", name: "Target" } }),
			]);
		}
	});

	it("blocks deleting a team when team memberships exist", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-a", organizationId: "org-1", name: "Alpha" }];
		mockState.teamMembershipRows = [
			[{ organizationId: "org-1", teamId: "team-a", employeeId: "target-1" }],
		];

		const result = await deleteTeam("team-a");

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Cannot delete team with active members. Please reassign members first.",
		);
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("keeps team actor lookups restricted to active employee rows", () => {
		const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

		expect(source.includes("eq(employee.isActive, true)")).toBe(true);
		expect(source.includes("resolveTeamSettingsActor")).toBe(true);
		expect(source.includes("getCurrentEmployee")).toBe(true);
	});

	it("rejects adding a member from an out-of-scope team", async () => {
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", description: null },
		];
		mockState.employeeQueue = [
			{
				id: "emp-manager",
				userId: "user-1",
				organizationId: "org-1",
				role: "manager",
				teamId: "team-a",
				user: { name: "Manager" },
			},
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-b",
				user: { name: "Target" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "member" }];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [
			{
				id: "perm-1",
				employeeId: "emp-manager",
				organizationId: "org-1",
				teamId: "team-a",
				canCreateTeams: false,
				canManageTeamMembers: true,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
			},
		];

		const result = await addTeamMember("team-a", "emp-target");

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
		expect(mockState.updateWhere).not.toHaveBeenCalled();
	});

	it("adds team membership without moving an employee out of another team", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.teamMembershipFindFirst.mockResolvedValue(null);

		const result = await addTeamMember("team-b", "target-1");

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-b",
				employeeId: "target-1",
				organizationId: "org-1",
			}),
		);
		expect(mockState.updateSet).not.toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team-b" }),
		);
	});

	it("adds team membership and sets compatibility team when employee has none", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.teamMembershipFindFirst.mockResolvedValue(null);

		const result = await addTeamMember("team-b", "target-1");

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
		mockState.teamQueue = [
			{ id: "team-b", organizationId: "org-1", name: "Beta", description: null },
		];
		mockState.employeeQueue = [
			{
				id: "emp-manager",
				userId: "user-1",
				organizationId: "org-1",
				role: "manager",
				teamId: "team-b",
				user: { name: "Manager" },
			},
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { name: "Target" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "member" }];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [
			{
				id: "perm-1",
				employeeId: "emp-manager",
				organizationId: "org-1",
				teamId: "team-b",
				canCreateTeams: false,
				canManageTeamMembers: true,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
			},
		];
		mockState.teamMembershipRows = [
			[{ organizationId: "org-1", teamId: "team-a", employeeId: "emp-target" }],
		];

		const result = await addTeamMember("team-b", "emp-target");

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
		expect(result.error).toBe("Cannot move employees from teams outside your scope");
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team-b" }),
		);
	});

	it("allows scoped manager adding employee with no memberships and no legacy team", async () => {
		mockState.teamQueue = [
			{ id: "team-b", organizationId: "org-1", name: "Beta", description: null },
		];
		mockState.employeeQueue = [
			{
				id: "emp-manager",
				userId: "user-1",
				organizationId: "org-1",
				role: "manager",
				teamId: "team-b",
				user: { name: "Manager" },
			},
			{
				id: "emp-target",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: null,
				user: { name: "Target" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "member" }];
		mockState.hasTeamPermission.mockResolvedValue(true);
		mockState.teamPermissionsRows = [
			{
				id: "perm-1",
				employeeId: "emp-manager",
				organizationId: "org-1",
				teamId: "team-b",
				canCreateTeams: false,
				canManageTeamMembers: true,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
			},
		];
		mockState.teamMembershipRows = [[]];

		const result = await addTeamMember("team-b", "emp-target");

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
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { id: "user-2", name: "Target", email: "target@example.com" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await addTeamMember("team-b", "target-1");

		expect(result.success).toBe(true);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				teamId: "team-b",
				employeeId: "target-1",
				organizationId: "org-1",
			}),
		);
		expect(mockState.onConflictDoNothing).toHaveBeenCalledOnce();
	});

	it("removes only selected team membership and reassigns compatibility team to another remaining membership", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-b",
				user: { name: "Target" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];
		mockState.teamMembershipRows = [
			[
				{ organizationId: "org-1", teamId: "team-c", employeeId: "target-1" },
				{ organizationId: "org-1", teamId: "team-a", employeeId: "target-1" },
			],
		];

		const result = await removeTeamMember("team-b", "target-1");

		expect(result.success).toBe(true);
		expect(mockState.deleteWhere).toHaveBeenCalled();
		expect(mockState.updateSet).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-a" }));
	});

	it("removes only selected team membership without changing a different compatibility team", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: "target-1",
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				teamId: "team-a",
				user: { name: "Target" },
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [{ id: "team-b", organizationId: "org-1", name: "Beta" }];

		const result = await removeTeamMember("team-b", "target-1");

		expect(result.success).toBe(true);
		expect(mockState.deleteWhere).toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ teamId: null }));
	});

	it("rejects primary manager assignment for employee role", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: employeePrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "employee",
				isActive: true,
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam("team-a", { primaryManagerId: employeePrimaryManagerId });

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Primary manager must be an active manager or admin in this organization",
		);
	});

	it("clears primary manager assignment", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				primaryManagerId: managerPrimaryManagerId,
			},
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam("team-a", { primaryManagerId: null });

		expect(result.success).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: null }),
		);
	});

	it("allows active manager primary manager assignment", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: managerPrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "manager",
				isActive: true,
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				primaryManagerId: managerPrimaryManagerId,
			},
		];

		const result = await updateTeam("team-a", { primaryManagerId: managerPrimaryManagerId });

		expect(result.success).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: managerPrimaryManagerId }),
		);
	});

	it("allows active admin primary manager assignment", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			{
				id: adminPrimaryManagerId,
				userId: "user-2",
				organizationId: "org-1",
				role: "admin",
				isActive: true,
			},
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
			{
				id: "team-a",
				organizationId: "org-1",
				name: "Alpha",
				primaryManagerId: adminPrimaryManagerId,
			},
		];

		const result = await updateTeam("team-a", { primaryManagerId: adminPrimaryManagerId });

		expect(result.success).toBe(true);
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ primaryManagerId: adminPrimaryManagerId }),
		);
	});

	it("rejects inactive or cross-org primary manager assignment", async () => {
		mockState.employeeQueue = [
			{ id: "admin-1", userId: "user-1", organizationId: "org-1", role: "admin", teamId: null },
			null,
		];
		mockState.membershipQueue = [{ organizationId: "org-1", role: "admin" }];
		mockState.teamQueue = [
			{ id: "team-a", organizationId: "org-1", name: "Alpha", primaryManagerId: null },
		];

		const result = await updateTeam("team-a", { primaryManagerId: foreignPrimaryManagerId });

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Primary manager must be an active manager or admin in this organization",
		);
	});
});
