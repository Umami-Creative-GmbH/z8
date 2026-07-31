import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	actor: {
		accessTier: "orgAdmin" as const,
		organizationId: "org-actor",
		session: { user: { id: "user-admin", email: "admin@example.test" } },
		currentEmployee: {
			id: "employee-admin",
			userId: "user-admin",
			organizationId: "org-actor",
			role: "admin" as const,
		},
	},
	findEmployees: vi.fn(async () => [
		{ id: "employee-actor", organizationId: "org-actor", userId: "user-actor" },
	]),
	findTeams: vi.fn(async () => [
		{ id: "team-actor", organizationId: "org-actor", name: "Actor Team" },
	]),
	findPermissions: vi.fn(async () => []),
	getEmployeePermissions: vi.fn(
		(_employeeId: string, _organizationId: string) => [],
	),
	grantPermissions: vi.fn(),
	revokePermissions: vi.fn(),
	transaction: vi.fn(),
	requireOrgAdmin: vi.fn(),
	loggerInfo: vi.fn(),
	loggerError: vi.fn(),
}));

const drizzleMocks = vi.hoisted(() => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
	eq: drizzleMocks.eq,
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "id",
		userId: "userId",
		organizationId: "organizationId",
		$inferSelect: {},
	},
	team: {
		id: "teamId",
		name: "teamName",
		organizationId: "teamOrganizationId",
	},
	teamPermissions: {
		employeeId: "permissionEmployeeId",
		organizationId: "permissionOrganizationId",
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: mockState.loggerInfo,
		error: mockState.loggerError,
	}),
}));

vi.mock("../employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	return {
		getEmployeeSettingsActorContext: vi.fn(() =>
			Effect.succeed(mockState.actor),
		),
		requireSettingsActorEmployeeRecord: vi.fn(() =>
			Effect.succeed(mockState.actor.currentEmployee),
		),
		requireOrgAdminEmployeeSettingsAccess:
			mockState.requireOrgAdmin.mockImplementation(() => Effect.void),
	};
});

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	return { AuthService: Context.GenericTag<unknown>("AuthService") };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	return { DatabaseService: Context.GenericTag<unknown>("DatabaseService") };
});

vi.mock("@/lib/effect/services/permissions.service", async () => {
	const { Context } = await import("effect");
	return {
		PermissionsService: Context.GenericTag<unknown>("PermissionsService"),
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { DatabaseService } = await import(
		"@/lib/effect/services/database.service"
	);
	const { PermissionsService } = await import(
		"@/lib/effect/services/permissions.service"
	);

	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				employee: { findMany: mockState.findEmployees },
				team: { findMany: mockState.findTeams },
				teamPermissions: { findMany: mockState.findPermissions },
			},
			transaction: mockState.transaction.mockImplementation(
				async (operation: (tx: unknown) => Promise<unknown>) =>
					operation({
						query: {
							employee: { findMany: mockState.findEmployees },
							team: { findMany: mockState.findTeams },
							teamPermissions: { findMany: mockState.findPermissions },
						},
					}),
			),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	});
	const permissionsLayer = Layer.succeed(PermissionsService, {
		getEmployeePermissions: (employeeId: string, organizationId: string) =>
			Effect.sync(() =>
				mockState.getEmployeePermissions(employeeId, organizationId),
			),
		grantPermissions: (
			employeeId: string,
			organizationId: string,
			permissions: unknown,
			teamId: string | null,
			grantedBy: string,
		) =>
			Effect.sync(() =>
				mockState.grantPermissions(
					employeeId,
					organizationId,
					permissions,
					teamId,
					grantedBy,
				),
			),
		revokePermissions: (
			employeeId: string,
			organizationId: string,
			teamId: string | null,
		) =>
			Effect.sync(() =>
				mockState.revokePermissions(employeeId, organizationId, teamId),
			),
	});

	return {
		AppLayer: Layer.merge(databaseLayer, permissionsLayer),
		runtime: {
			runPromiseExit: (effect: Parameters<typeof Effect.runPromiseExit>[0]) =>
				Effect.runPromiseExit(effect),
		},
	};
});

const actions = await import("./actions");
const {
	grantTeamPermissions,
	listEmployeePermissions,
	loadPermissionsPageData,
	revokeTeamPermissions,
} = actions;

describe("permissions settings server scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.actor.currentEmployee.role = "admin";
		mockState.findEmployees.mockResolvedValue([
			{
				id: "employee-actor",
				organizationId: "org-actor",
				userId: "user-actor",
			},
		]);
		mockState.findTeams.mockResolvedValue([
			{ id: "team-actor", organizationId: "org-actor", name: "Actor Team" },
		]);
		mockState.findPermissions.mockResolvedValue([]);
		mockState.getEmployeePermissions.mockReturnValue([]);
	});

	it("derives grant organization and granter employee exclusively from the actor", async () => {
		mockState.actor.currentEmployee.role = "employee";
		const result = await grantTeamPermissions({
			employeeId: "10000000-0000-4000-8000-000000000001",
			permissions: { canCreateTeams: true },
			teamId: null,
			organizationId: "org-attacker",
		} as Parameters<typeof grantTeamPermissions>[0]);

		expect(result.success).toBe(true);
		expect(mockState.grantPermissions).toHaveBeenCalledWith(
			"10000000-0000-4000-8000-000000000001",
			"org-actor",
			{ canCreateTeams: true },
			null,
			"employee-admin",
		);
	});

	it("derives revoke organization exclusively from the actor", async () => {
		const result = await revokeTeamPermissions(
			"10000000-0000-4000-8000-000000000001",
			"20000000-0000-4000-8000-000000000001",
		);

		expect(result.success).toBe(true);
		expect(mockState.revokePermissions).toHaveBeenCalledWith(
			"10000000-0000-4000-8000-000000000001",
			"org-actor",
			"20000000-0000-4000-8000-000000000001",
		);
	});

	it("ignores a caller organization and lists only actor-organization employees", async () => {
		const invokeWithHostileOrganization =
			listEmployeePermissions as unknown as (
				organizationId: string,
			) => ReturnType<typeof listEmployeePermissions>;

		const result = await invokeWithHostileOrganization("org-attacker");

		expect(result.success).toBe(true);
		expect(mockState.requireOrgAdmin).toHaveBeenCalledWith(
			mockState.actor,
			expect.objectContaining({ action: "list" }),
		);
		expect(drizzleMocks.eq).toHaveBeenCalledWith("organizationId", "org-actor");
		expect(mockState.findEmployees).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { eq: ["organizationId", "org-actor"] },
			}),
		);
		expect(mockState.getEmployeePermissions).toHaveBeenCalledTimes(1);
		expect(mockState.getEmployeePermissions).toHaveBeenCalledWith(
			"employee-actor",
			"org-actor",
		);
	});

	it("rejects a mismatched expected organization before any data query", async () => {
		const result = await loadPermissionsPageData("org-other");

		expect(result.success).toBe(false);
		expect(mockState.requireOrgAdmin).toHaveBeenCalled();
		expect(mockState.findEmployees).not.toHaveBeenCalled();
		expect(mockState.findTeams).not.toHaveBeenCalled();
		expect(mockState.findPermissions).not.toHaveBeenCalled();
		expect(mockState.transaction).not.toHaveBeenCalled();
		expect(mockState.getEmployeePermissions).not.toHaveBeenCalled();
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
				currentHourlyRate: "999.00",
				user: {
					id: "user-actor",
					firstName: "Ada",
					lastName: "Lovelace",
					name: "Ada Lovelace",
					email: "ada@example.test",
					image: null,
					passwordHash: "secret",
				},
				team: {
					id: "team-actor",
					name: "Actor Team",
					description: "private",
				},
			},
		]);
		mockState.findTeams.mockResolvedValue([
			{
				id: "team-actor",
				organizationId: "org-actor",
				name: "Actor Team",
				description: "private",
			},
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
		const result = await loadPermissionsPageData("org-actor");

		expect(mockState.transaction).toHaveBeenCalledOnce();
		expect(mockState.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "repeatable read",
		});
		expect(mockState.getEmployeePermissions).not.toHaveBeenCalled();
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
				teams: [
					{ id: "team-actor", organizationId: "org-actor", name: "Actor Team" },
				],
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
		expect(drizzleMocks.eq).toHaveBeenCalledWith("organizationId", "org-actor");
		expect(drizzleMocks.eq).toHaveBeenCalledWith(
			"teamOrganizationId",
			"org-actor",
		);
		expect(drizzleMocks.eq).toHaveBeenCalledWith(
			"permissionOrganizationId",
			"org-actor",
		);
	});

	it("returns actor organization identity when all scoped collections are empty", async () => {
		mockState.findEmployees.mockResolvedValue([]);
		mockState.findTeams.mockResolvedValue([]);
		const result = await loadPermissionsPageData("org-actor");

		expect(result).toMatchObject({
			success: true,
			data: {
				organizationId: "org-actor",
				employees: [],
				teams: [],
				permissions: [],
			},
		});
	});
});
