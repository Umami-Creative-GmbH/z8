import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	session: {
		user: {
			id: "user-manager",
			email: "manager@example.com",
		},
		session: {
			activeOrganizationId: "org-1",
		},
	},
	membershipRecord: { role: "member" as const },
	currentEmployee: {
		id: "employee-manager",
		organizationId: "org-1",
		role: "manager" as const,
	},
	teamPermissionsRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	locationRows: [{ locationId: "location-managed", employeeId: "employee-location" }],
	subareaRows: [{ subareaId: "subarea-managed", employeeId: "employee-subarea" }],
	managedProjects: [{ projectId: "project-managed" }],
	scopedProjects: [{ id: "project-managed" }],
	projectAssignments: [
		{ assignmentType: "employee", employeeId: "employee-project", teamId: null },
		{ assignmentType: "team", employeeId: null, teamId: "team-project" },
	],
	teamScopedEmployees: [
		{ id: "employee-team" },
		{ id: "employee-project-team" },
	],
	calendarSettings: {
		googleEnabled: true,
		microsoft365Enabled: false,
		icsFeedsEnabled: true,
		teamIcsFeedsEnabled: false,
		autoSyncOnApproval: true,
		conflictDetectionRequired: true,
		eventTitleTemplate: "Out of Office - {categoryName}",
		eventDescriptionTemplate: "Managed by Z8",
	},
	calendarConnections: [
		{
			id: "conn-team",
			employeeId: "employee-team",
			organizationId: "org-1",
			provider: "google",
			providerAccountId: "team@example.com",
			calendarId: "primary",
			pushEnabled: true,
			conflictDetectionEnabled: true,
			lastSyncAt: new Date("2026-03-01T12:00:00.000Z"),
			lastSyncError: null,
			isActive: true,
			createdAt: new Date("2026-02-01T12:00:00.000Z"),
			employee: { id: "employee-team", firstName: "Tina", lastName: "Team" },
		},
		{
			id: "conn-location",
			employeeId: "employee-location",
			organizationId: "org-1",
			provider: "google",
			providerAccountId: "location@example.com",
			calendarId: "primary",
			pushEnabled: true,
			conflictDetectionEnabled: true,
			lastSyncAt: null,
			lastSyncError: null,
			isActive: true,
			createdAt: new Date("2026-02-02T12:00:00.000Z"),
			employee: { id: "employee-location", firstName: "Lena", lastName: "Location" },
		},
		{
			id: "conn-subarea",
			employeeId: "employee-subarea",
			organizationId: "org-1",
			provider: "microsoft365",
			providerAccountId: "subarea@example.com",
			calendarId: "primary",
			pushEnabled: true,
			conflictDetectionEnabled: false,
			lastSyncAt: null,
			lastSyncError: "Needs re-auth",
			isActive: true,
			createdAt: new Date("2026-02-03T12:00:00.000Z"),
			employee: { id: "employee-subarea", firstName: "Sam", lastName: "Subarea" },
		},
		{
			id: "conn-project",
			employeeId: "employee-project",
			organizationId: "org-1",
			provider: "google",
			providerAccountId: "project@example.com",
			calendarId: "primary",
			pushEnabled: false,
			conflictDetectionEnabled: true,
			lastSyncAt: null,
			lastSyncError: null,
			isActive: true,
			createdAt: new Date("2026-02-04T12:00:00.000Z"),
			employee: { id: "employee-project", firstName: "Pia", lastName: "Project" },
		},
		{
			id: "conn-project-team",
			employeeId: "employee-project-team",
			organizationId: "org-1",
			provider: "microsoft365",
			providerAccountId: "project-team@example.com",
			calendarId: "primary",
			pushEnabled: true,
			conflictDetectionEnabled: true,
			lastSyncAt: null,
			lastSyncError: null,
			isActive: true,
			createdAt: new Date("2026-02-05T12:00:00.000Z"),
			employee: { id: "employee-project-team", firstName: "Pat", lastName: "Projectteam" },
		},
		{
			id: "conn-outsider",
			employeeId: "employee-outsider",
			organizationId: "org-1",
			provider: "google",
			providerAccountId: "outsider@example.com",
			calendarId: "primary",
			pushEnabled: true,
			conflictDetectionEnabled: true,
			lastSyncAt: null,
			lastSyncError: null,
			isActive: true,
			createdAt: new Date("2026-02-06T12:00:00.000Z"),
			employee: { id: "employee-outsider", firstName: "Olly", lastName: "Outside" },
		},
	],
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "userId",
		organizationId: "organizationId",
		role: "role",
	},
}));

vi.mock("@/db/schema", () => ({
	calendarConnection: {
		organizationId: "organizationId",
	},
	employee: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		teamId: "teamId",
	},
	locationEmployee: {
		employeeId: "employeeId",
		locationId: "locationId",
	},
	organizationCalendarSettings: {
		organizationId: "organizationId",
	},
	project: {
		id: "id",
		organizationId: "organizationId",
	},
	projectAssignment: {
		organizationId: "organizationId",
		projectId: "projectId",
	},
	projectManager: {
		employeeId: "employeeId",
	},
	subareaEmployee: {
		employeeId: "employeeId",
		subareaId: "subareaId",
	},
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
}));

vi.mock("@/lib/calendar-sync/providers", () => ({
	getSupportedProviders: vi.fn(() => [
		{ provider: "google", displayName: "Google Calendar", enabled: true },
		{ provider: "microsoft365", displayName: "Microsoft 365", enabled: true },
	]),
	isProviderSupported: vi.fn((provider: string) => provider === "google" || provider === "microsoft365"),
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return { DatabaseService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const authService = {
		getSession: vi.fn(() => Effect.succeed(mockState.session)),
	};

	const dbService = {
		db: {
			query: {
				member: {
					findFirst: vi.fn(async () => mockState.membershipRecord),
				},
				employee: {
					findFirst: vi.fn(async () => mockState.currentEmployee),
					findMany: vi.fn(async () => mockState.teamScopedEmployees),
				},
				teamPermissions: {
					findMany: vi.fn(async () => mockState.teamPermissionsRows),
				},
				locationEmployee: {
					findMany: vi.fn(async () => mockState.locationRows),
				},
				subareaEmployee: {
					findMany: vi.fn(async () => mockState.subareaRows),
				},
				projectManager: {
					findMany: vi.fn(async () => mockState.managedProjects),
				},
				project: {
					findMany: vi.fn(async () => mockState.scopedProjects),
				},
				projectAssignment: {
					findMany: vi.fn(async () => mockState.projectAssignments),
				},
				calendarConnection: {
					findMany: vi.fn(async () => mockState.calendarConnections),
				},
				organizationCalendarSettings: {
					findFirst: vi.fn(async () => mockState.calendarSettings),
				},
			},
		},
		query: (_name: string, fn: () => Promise<unknown>) => Effect.promise(fn),
	};

	const AppLayer = Layer.mergeAll(
		Layer.succeed(AuthService, authService),
		Layer.succeed(DatabaseService, dbService),
	);

	return {
		AppLayer,
		runtime: {
			runPromiseExit: (effect: any) => Effect.runPromiseExit(effect),
		},
	};
});

describe("calendar settings actions", () => {
	beforeEach(() => {
		mockState.session = {
			user: {
				id: "user-manager",
				email: "manager@example.com",
			},
			session: {
				activeOrganizationId: "org-1",
			},
		};
		mockState.membershipRecord = { role: "member" };
		mockState.currentEmployee = {
			id: "employee-manager",
			organizationId: "org-1",
			role: "manager",
		};
		mockState.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.locationRows = [{ locationId: "location-managed", employeeId: "employee-location" }];
		mockState.subareaRows = [{ subareaId: "subarea-managed", employeeId: "employee-subarea" }];
		mockState.managedProjects = [{ projectId: "project-managed" }];
		mockState.scopedProjects = [{ id: "project-managed" }];
		mockState.projectAssignments = [
			{ assignmentType: "employee", employeeId: "employee-project", teamId: null },
			{ assignmentType: "team", employeeId: null, teamId: "team-project" },
		];
		mockState.teamScopedEmployees = [{ id: "employee-team" }, { id: "employee-project-team" }];
	});

	it("returns only manager-scoped calendar integrations for read access", async () => {
		const { getManagerCalendarReadView } = await import("./actions");

		const result = await getManagerCalendarReadView();

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data.relevantConnections.map((connection) => connection.id).sort()).toEqual([
			"conn-location",
			"conn-project",
			"conn-project-team",
			"conn-subarea",
			"conn-team",
		]);
	});

	it("keeps owner and admin parity with full organization calendar settings access", async () => {
		mockState.membershipRecord = { role: "owner" };
		mockState.currentEmployee = null;

		const { getCalendarSettings } = await import("./actions");
		const result = await getCalendarSettings();

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data.googleEnabled).toBe(true);
		expect(result.data.microsoft365Enabled).toBe(false);
		expect(result.data.eventTitleTemplate).toBe("Out of Office - {categoryName}");
		expect(result.data.relevantConnections.map((connection) => connection.id).sort()).toEqual([
			"conn-location",
			"conn-outsider",
			"conn-project",
			"conn-project-team",
			"conn-subarea",
			"conn-team",
		]);
	});

	it("rejects managers from reading org-wide calendar settings", async () => {
		const { getCalendarSettings } = await import("./actions");

		const result = await getCalendarSettings();

		expect(result).toEqual({
			success: false,
			error: "Only org admins can read calendar settings",
			code: "AuthorizationError",
		});
	});

	it("rejects direct manager calendar setting mutations", async () => {
		const { updateCalendarSettings } = await import("./actions");

		const result = await updateCalendarSettings({
			googleEnabled: true,
			microsoft365Enabled: true,
			icsFeedsEnabled: true,
			teamIcsFeedsEnabled: true,
			autoSyncOnApproval: true,
			conflictDetectionRequired: false,
			eventTitleTemplate: "Out of Office - {categoryName}",
			eventDescriptionTemplate: null,
		});

		expect(result).toEqual({
			success: false,
			error: "Only org admins can update calendar settings",
			code: "AuthorizationError",
		});
	});
});
