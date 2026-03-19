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
	teamScopedEmployees: [
		{ id: "employee-1", isActive: true },
		{ id: "employee-2", isActive: false },
	],
	selectResults: [] as Array<Array<{ count: number }>>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	count: vi.fn(() => ({ count: true })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	lt: vi.fn((left: unknown, right: unknown) => ({ lt: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "userId",
		organizationId: "organizationId",
		role: "role",
	},
	organization: { id: "organizationId" },
	session: { id: "sessionId" },
	user: { id: "userId" },
}));

vi.mock("@/db/schema", () => ({
	absenceEntry: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		status: "status",
	},
	approvalRequest: {
		approverId: "approverId",
		organizationId: "organizationId",
		requestedBy: "requestedBy",
		status: "status",
	},
	employee: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		role: "role",
		teamId: "teamId",
		userId: "userId",
	},
	team: {
		id: "id",
		organizationId: "organizationId",
	},
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
	timeEntry: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		timestamp: "timestamp",
	},
}));

vi.mock("@/db", () => {
	const nextResult = () => Promise.resolve(mockState.selectResults.shift() ?? [{ count: 0 }]);
	const select = vi.fn(() => ({
		from: vi.fn(() => {
			let consumed = false;
			let cachedResult: Promise<Array<{ count: number }>> | null = null;
			const resolveResult = () => {
				if (!cachedResult) {
					cachedResult = nextResult();
				}
				consumed = true;
				return cachedResult;
			};

			return {
				where: vi.fn(() => {
					consumed = true;
					return nextResult();
				}),
				then: (...args: Parameters<Promise<Array<{ count: number }>>["then"]>) =>
					resolveResult().then(...args),
				catch: (...args: Parameters<Promise<Array<{ count: number }>>["catch"]>) =>
					(consumed ? resolveResult() : resolveResult()).catch(...args),
				finally: (...args: Parameters<Promise<Array<{ count: number }>>["finally"]>) =>
					resolveResult().finally(...args),
			};
		}),
	}));

	return {
		db: {
			select,
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
			},
		},
	};
});

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");

	const authService = {
		getSession: vi.fn(() => Effect.succeed(mockState.session)),
	};

	return {
		AppLayer: Layer.succeed(AuthService, authService),
		runtime: {
			runPromiseExit: (effect: any) => Effect.runPromiseExit(effect),
		},
	};
});

describe("statistics actions", () => {
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
		mockState.currentEmployee = {
			id: "employee-manager",
			organizationId: "org-1",
			role: "manager",
		};
		mockState.membershipRecord = { role: "member" };
		mockState.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.teamScopedEmployees = [
			{ id: "employee-1", isActive: true },
			{ id: "employee-2", isActive: false },
		];
		mockState.selectResults = [];
	});

	it("returns only team-scoped analytics for manager read access", async () => {
		mockState.selectResults = [
			[{ count: 1 }],
			[{ count: 6 }],
			[{ count: 4 }],
			[{ count: 2 }],
			[{ count: 3 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 1 }],
			[{ count: 2 }],
			[{ count: 1 }],
		];

		const { getManagerStatisticsReadView } = await import("./actions");
		const result = await getManagerStatisticsReadView();

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data).toMatchObject({
			totalEmployees: 2,
			activeEmployees: 1,
			inactiveEmployees: 1,
			totalTeams: 1,
			totalTimeEntries: 6,
			timeEntriesThisMonth: 4,
			timeEntriesLastMonth: 2,
			totalAbsences: 3,
			pendingAbsences: 1,
			approvedAbsences: 1,
			rejectedAbsences: 1,
			totalApprovals: 2,
			pendingApprovals: 1,
		});
		expect(result.data).not.toHaveProperty("activeSessions");
		expect(result.data).not.toHaveProperty("totalOrganizations");
		expect(result.data).not.toHaveProperty("totalUsers");
		expect(typeof result.data.fetchedAt).toBe("string");
	});

	it("keeps owner and admin parity with active-organization statistics only", async () => {
		mockState.session.user.id = "user-owner";
		mockState.membershipRecord = { role: "owner" };
		mockState.currentEmployee = null;
		mockState.selectResults = [
			[{ count: 8 }],
			[{ count: 6 }],
			[{ count: 4 }],
			[{ count: 30 }],
			[{ count: 12 }],
			[{ count: 9 }],
			[{ count: 7 }],
			[{ count: 2 }],
			[{ count: 3 }],
			[{ count: 2 }],
			[{ count: 6 }],
			[{ count: 1 }],
			[{ count: 5 }],
		];

		const { getOrganizationStats } = await import("./actions");
		const result = await getOrganizationStats();

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data).toMatchObject({
			totalEmployees: 8,
			activeEmployees: 6,
			inactiveEmployees: 2,
			totalTeams: 4,
			totalTimeEntries: 30,
			timeEntriesThisMonth: 12,
			timeEntriesLastMonth: 9,
			totalAbsences: 7,
			pendingAbsences: 2,
			approvedAbsences: 3,
			rejectedAbsences: 2,
			totalApprovals: 6,
			pendingApprovals: 1,
			activeSessions: 5,
		});
		expect(result.data).not.toHaveProperty("totalUsers");
		expect(result.data).not.toHaveProperty("totalOrganizations");
	});

	it("rejects managers from reading org-wide statistics directly", async () => {
		const { getOrganizationStats } = await import("./actions");
		const result = await getOrganizationStats();

		expect(result).toEqual({
			success: false,
			error: "Only org admins can view instance statistics",
			code: "AuthorizationError",
		});
	});

	it("keeps the statistics actor lookup restricted to active employee rows", async () => {
		const { getOrganizationStats } = await import("./actions");
		const { db } = await import("@/db");

		await getOrganizationStats();

		expect(vi.mocked(db.query.employee.findFirst).mock.calls[0]?.[0]).toMatchObject({
			where: {
				and: expect.arrayContaining([{ eq: ["isActive", true] }]),
			},
		});
	});
});
