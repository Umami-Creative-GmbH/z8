import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	actor: {
		accessTier: "manager" as const,
		organizationId: "org-1",
		session: {
			user: {
				id: "user-1",
				email: "manager@example.com",
			},
		},
		currentEmployee: {
			id: "manager-employee-1",
			organizationId: "org-1",
			role: "manager" as const,
		},
		dbService: null as any,
	},
	managedEmployeeIds: new Set<string>(["employee-managed"]),
	teamPermissionRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	teamRows: [
		{ id: "team-managed", organizationId: "org-1", name: "Managed Team" },
		{ id: "team-other", organizationId: "org-1", name: "Other Team" },
	],
	employeeRows: [
		{ id: "employee-managed", organizationId: "org-1", firstName: "Mina", lastName: "Miller", isActive: true, teamId: "team-managed" },
		{ id: "employee-fallback", organizationId: "org-1", firstName: "Fall", lastName: "Back", isActive: true, teamId: null },
		{ id: "employee-other", organizationId: "org-1", firstName: "Otto", lastName: "Other", isActive: true, teamId: "team-other" },
	],
	policyRows: [
		{ id: "policy-org", organizationId: "org-1", name: "Org Default", isActive: true, createdAt: new Date("2026-01-01T00:00:00.000Z") },
		{ id: "policy-team", organizationId: "org-1", name: "Managed Team Policy", isActive: true, createdAt: new Date("2026-01-02T00:00:00.000Z") },
		{ id: "policy-other", organizationId: "org-1", name: "Other Team Policy", isActive: true, createdAt: new Date("2026-01-03T00:00:00.000Z") },
	],
	assignmentRows: [
		{
			id: "assignment-org",
			policyId: "policy-org",
			organizationId: "org-1",
			assignmentType: "organization" as const,
			teamId: null,
			employeeId: null,
			priority: 0,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			policy: {
				id: "policy-org",
				name: "Org Default",
				selfServiceDays: 0,
				approvalDays: 7,
				noApprovalRequired: false,
			},
			team: null,
			employee: null,
		},
		{
			id: "assignment-team-managed",
			policyId: "policy-team",
			organizationId: "org-1",
			assignmentType: "team" as const,
			teamId: "team-managed",
			employeeId: null,
			priority: 1,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			policy: {
				id: "policy-team",
				name: "Managed Team Policy",
				selfServiceDays: 2,
				approvalDays: 5,
				noApprovalRequired: false,
			},
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "assignment-employee-managed",
			policyId: "policy-team",
			organizationId: "org-1",
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "employee-managed",
			priority: 2,
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			policy: {
				id: "policy-team",
				name: "Managed Team Policy",
				selfServiceDays: 2,
				approvalDays: 5,
				noApprovalRequired: false,
			},
			team: null,
			employee: { id: "employee-managed", firstName: "Mina", lastName: "Miller" },
		},
		{
			id: "assignment-team-other",
			policyId: "policy-other",
			organizationId: "org-1",
			assignmentType: "team" as const,
			teamId: "team-other",
			employeeId: null,
			priority: 1,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			policy: {
				id: "policy-other",
				name: "Other Team Policy",
				selfServiceDays: 4,
				approvalDays: 9,
				noApprovalRequired: false,
			},
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
	],
	insertedPolicies: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
}));

vi.mock("@/db/schema", () => ({
	changePolicy: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		createdAt: "createdAt",
		selfServiceDays: "selfServiceDays",
		approvalDays: "approvalDays",
		noApprovalRequired: "noApprovalRequired",
		$inferSelect: {},
	},
	changePolicyAssignment: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		priority: "priority",
		createdAt: "createdAt",
		assignmentType: "assignmentType",
		teamId: "teamId",
		employeeId: "employeeId",
		policyId: "policyId",
		$inferSelect: {},
	},
		employee: {
			id: "id",
			organizationId: "organizationId",
			teamId: "teamId",
			isActive: "isActive",
		firstName: "firstName",
		lastName: "lastName",
		$inferSelect: {},
	},
	team: { id: "id", organizationId: "organizationId", name: "name" },
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
}));

vi.mock("../employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");

	return {
		getEmployeeSettingsActorContext: vi.fn(() =>
			Effect.succeed({
				...mockState.actor,
				dbService: {
					db: {
						query: {
							changePolicy: {
								findMany: vi.fn(async () => mockState.policyRows),
							},
							changePolicyAssignment: {
								findMany: vi.fn(async () => mockState.assignmentRows),
							},
							team: {
								findMany: vi.fn(async () => mockState.teamRows),
							},
							employee: {
								findMany: vi.fn(async () =>
									mockState.employeeRows.filter((employee) =>
										mockState.managedEmployeeIds.has(employee.id),
									),
								),
							},
							teamPermissions: {
								findMany: vi.fn(async () => mockState.teamPermissionRows),
							},
						},
						insert: vi.fn(() => ({
							values: vi.fn((value: unknown) => ({
								returning: vi.fn(async () => {
									mockState.insertedPolicies.push(value);
									return [{ id: "created-policy" }];
								}),
							})),
						})),
						update: vi.fn(() => ({
							set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
						})),
					},
					query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
				},
			}),
		),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() => Effect.succeed(mockState.managedEmployeeIds)),
		requireOrgAdminEmployeeSettingsAccess: vi.fn((actor: typeof mockState.actor, options: any) =>
			actor.accessTier === "orgAdmin"
				? Effect.void
				: Effect.fail(
						new AuthorizationError({
							message: options.message,
							userId: actor.session.user.id,
							resource: options.resource,
							action: options.action,
						}),
				  ),
		),
	};
});

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
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const db = {
		query: {
			changePolicy: {
				findMany: vi.fn(async () => mockState.policyRows),
			},
			changePolicyAssignment: {
				findMany: vi.fn(async () => mockState.assignmentRows),
			},
			team: {
				findMany: vi.fn(async () => mockState.teamRows),
			},
			employee: {
				findMany: vi.fn(async () =>
					mockState.employeeRows.filter((employee) => mockState.managedEmployeeIds.has(employee.id)),
				),
			},
			teamPermissions: {
				findMany: vi.fn(async () => mockState.teamPermissionRows),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn((value: unknown) => ({
				returning: vi.fn(async () => {
					mockState.insertedPolicies.push(value);
					return [{ id: "created-policy" }];
				}),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
		})),
	};

	return {
		AppLayer: Layer.succeed(DatabaseService, {
			db,
			query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
		}),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T>(effect: any) => {
			const exit = await Effect.runPromiseExit(effect);
			return Exit.match(exit, {
				onSuccess: (data) => ({ success: true as const, data: data as T }),
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					if (error && typeof error === "object" && "_tag" in error) {
						return {
							success: false as const,
							error: (error as { message: string }).message,
							code: (error as { _tag: string })._tag,
						};
					}

					return { success: false as const, error: "Unknown error" };
				},
			});
		},
		type: {},
	};
});

describe("change policy scoped access", () => {
	beforeEach(() => {
		mockState.actor = {
			...mockState.actor,
			accessTier: "manager",
			currentEmployee: {
				id: "manager-employee-1",
				organizationId: "org-1",
				role: "manager",
			},
		};
		mockState.managedEmployeeIds = new Set(["employee-managed"]);
		mockState.teamPermissionRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.insertedPolicies = [];
	});

	it("returns only policies assigned to a manager's teams or managed employees", async () => {
		const { getChangePolicies } = await import("./actions");

		const result = await getChangePolicies("org-1");

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data.map((policy) => policy.id)).toEqual(["policy-team"]);
	});

	it("returns only assignments within a manager's scoped visibility", async () => {
		const { getChangePolicyAssignments } = await import("./actions");

		const result = await getChangePolicyAssignments("org-1");

		expect(result.success).toBe(true);
		if (!result.success) {
			return;
		}

		expect(result.data.map((assignment) => assignment.id)).toEqual([
			"assignment-employee-managed",
			"assignment-team-managed",
		]);
	});

	it("includes the organization default when it is the effective fallback for managed scope", async () => {
		mockState.managedEmployeeIds = new Set(["employee-fallback"]);
		mockState.teamPermissionRows = [];

		const { getChangePolicies, getChangePolicyAssignments } = await import("./actions");

		const policiesResult = await getChangePolicies("org-1");
		expect(policiesResult.success).toBe(true);
		if (!policiesResult.success) {
			return;
		}

		expect(policiesResult.data.map((policy) => policy.id)).toEqual(["policy-org"]);

		const assignmentsResult = await getChangePolicyAssignments("org-1");
		expect(assignmentsResult.success).toBe(true);
		if (!assignmentsResult.success) {
			return;
		}

		expect(assignmentsResult.data.map((assignment) => assignment.id)).toEqual(["assignment-org"]);
	});

	it("includes an unmanaged team's policy when it effectively governs a directly managed employee", async () => {
		mockState.managedEmployeeIds = new Set(["employee-other"]);
		mockState.teamPermissionRows = [];

		const { getChangePolicies, getChangePolicyAssignments } = await import("./actions");

		const policiesResult = await getChangePolicies("org-1");
		expect(policiesResult.success).toBe(true);
		if (!policiesResult.success) {
			return;
		}

		expect(policiesResult.data.map((policy) => policy.id)).toEqual(["policy-other"]);

		const assignmentsResult = await getChangePolicyAssignments("org-1");
		expect(assignmentsResult.success).toBe(true);
		if (!assignmentsResult.success) {
			return;
		}

		expect(assignmentsResult.data.map((assignment) => assignment.id)).toEqual([
			"assignment-team-other",
		]);
	});

	it("rejects direct manager policy mutations on the server", async () => {
		const { createChangePolicy } = await import("./actions");

		const result = await createChangePolicy("org-1", {
			name: "Blocked",
			selfServiceDays: 1,
			approvalDays: 2,
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insertedPolicies).toHaveLength(0);
	});

	it("keeps owner and admin parity for policy mutations", async () => {
		mockState.actor = {
			...mockState.actor,
			accessTier: "orgAdmin",
			currentEmployee: null,
		};

		const { createChangePolicy } = await import("./actions");

		const result = await createChangePolicy("org-1", {
			name: "Allowed",
			selfServiceDays: 1,
			approvalDays: 3,
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "created-policy" },
		});
		expect(mockState.insertedPolicies).toHaveLength(1);
	});
});
