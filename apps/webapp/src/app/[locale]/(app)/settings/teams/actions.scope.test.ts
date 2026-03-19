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
		teamPermissionsRows: [] as Array<any>,
		hasTeamPermission: vi.fn(async () => false),
		revalidateTag: vi.fn(),
		loggerInfo: vi.fn(),
		loggerError: vi.fn(),
		onTeamMemberAdded: vi.fn(),
		onTeamMemberRemoved: vi.fn(),
		insertReturning: vi.fn(async () => []),
		updateWhere: vi.fn(async () => undefined),
		deleteWhere: vi.fn(async () => undefined),
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
	employee: { userId: "userId", organizationId: "organizationId", id: "id", teamId: "teamId" },
	team: { id: "id", organizationId: "organizationId", name: "name", $inferSelect: {} },
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
				employee: { findFirst: (input: unknown) => Promise<any> };
				member: { findFirst: (input: unknown) => Promise<any> };
				team: { findFirst: (input: unknown) => Promise<any>; findMany: (input: unknown) => Promise<any[]> };
				teamPermissions: { findMany: (input: unknown) => Promise<any[]> };
			};
			insert: (table: unknown) => { values: (input: unknown) => { returning: () => Promise<any[]> } };
			update: (table: unknown) => { set: (input: unknown) => { where: (input: unknown) => Promise<void> } };
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
				},
				member: {
					findFirst: vi.fn(async () => mockState.membershipQueue.shift() ?? null),
				},
				team: {
					findFirst: vi.fn(async () => mockState.teamQueue.shift() ?? null),
					findMany: vi.fn(async () => mockState.teamQueue.shift() ?? []),
				},
				teamPermissions: {
					findMany: vi.fn(async () => mockState.teamPermissionsRows),
				},
			},
			insert: vi.fn(() => ({
				values: vi.fn(() => ({ returning: mockState.insertReturning })),
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({ where: mockState.updateWhere })),
			})),
			delete: vi.fn(() => ({ where: mockState.deleteWhere })),
		},
		query: <T>(_key: string, fn: () => Promise<T>) => Effect.promise(fn),
	});

	const permissionsLayer = Layer.succeed(PermissionsService, {
		hasTeamPermission: (...args: unknown[]) => Effect.promise(() => mockState.hasTeamPermission(...args)),
	});

	return {
		AppLayer: Layer.mergeAll(authLayer, databaseLayer, permissionsLayer),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = <T>(exit: unknown) =>
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

const { addTeamMember, createTeam, getTeam } = await import("./actions");

describe("team settings server scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.employeeQueue = [];
		mockState.membershipQueue = [];
		mockState.teamQueue = [];
		mockState.teamPermissionsRows = [];
		mockState.hasTeamPermission.mockResolvedValue(false);
		mockState.insertReturning.mockResolvedValue([]);
	});

	it("rejects manager team creation even when canCreateTeams is granted", async () => {
		mockState.employeeQueue = [
			{ id: "emp-1", userId: "user-1", organizationId: "org-1", role: "manager", teamId: "team-a" },
		];
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

	it("rejects non-manager employees from reading scoped team settings even with team permissions", async () => {
		mockState.employeeQueue = [
			{ id: "emp-1", userId: "user-1", organizationId: "org-1", role: "employee", teamId: "team-a" },
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
});
