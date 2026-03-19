import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	actor: {
		accessTier: "manager" as const,
		organizationId: "org-1",
		dbService: null as any,
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
	},
	managedEmployeeIds: new Set<string>(["employee-managed"]),
	teamPermissionsRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	holidayAssignments: [
		{
			id: "assignment-org",
			holidayId: "holiday-org",
			organizationId: "org-1",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			holiday: {
				id: "holiday-org",
				name: "Company Day",
				description: null,
				startDate: new Date("2026-05-01T00:00:00.000Z"),
				endDate: new Date("2026-05-01T00:00:00.000Z"),
				recurrenceType: "none",
			},
			team: null,
			employee: null,
		},
		{
			id: "assignment-team",
			holidayId: "holiday-team",
			organizationId: "org-1",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			holiday: {
				id: "holiday-team",
				name: "Team Day",
				description: null,
				startDate: new Date("2026-06-01T00:00:00.000Z"),
				endDate: new Date("2026-06-01T00:00:00.000Z"),
				recurrenceType: "none",
			},
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "assignment-employee",
			holidayId: "holiday-employee",
			organizationId: "org-1",
			assignmentType: "employee",
			teamId: null,
			employeeId: "employee-managed",
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			holiday: {
				id: "holiday-employee",
				name: "Employee Day",
				description: null,
				startDate: new Date("2026-07-01T00:00:00.000Z"),
				endDate: new Date("2026-07-01T00:00:00.000Z"),
				recurrenceType: "none",
			},
			team: null,
			employee: { id: "employee-managed", firstName: "Mina", lastName: "Miller" },
		},
		{
			id: "assignment-other-team",
			holidayId: "holiday-other-team",
			organizationId: "org-1",
			assignmentType: "team",
			teamId: "team-other",
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			holiday: {
				id: "holiday-other-team",
				name: "Other Team Day",
				description: null,
				startDate: new Date("2026-08-01T00:00:00.000Z"),
				endDate: new Date("2026-08-01T00:00:00.000Z"),
				recurrenceType: "none",
			},
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
	],
	countResult: 4,
	updateCalls: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	asc: vi.fn((value: unknown) => value),
	count: vi.fn(() => "count"),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	ilike: vi.fn((left: unknown, right: unknown) => ({ ilike: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
	or: vi.fn((...args: unknown[]) => ({ or: args })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id" },
	holiday: { id: "id", organizationId: "organizationId", isActive: "isActive", categoryId: "categoryId", name: "name", description: "description", startDate: "startDate" },
	holidayAssignment: {
		id: "id",
		holidayId: "holidayId",
		organizationId: "organizationId",
		assignmentType: "assignmentType",
		teamId: "teamId",
		employeeId: "employeeId",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	holidayCategory: { id: "id", organizationId: "organizationId", isActive: "isActive", name: "name" },
	team: { id: "id", name: "name" },
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");

	return {
		getEmployeeSettingsActorContext: vi.fn(() =>
			Effect.succeed({
				...mockState.actor,
				dbService: {
					db: {
						query: {
							teamPermissions: {
								findMany: vi.fn(async () => mockState.teamPermissionsRows),
							},
							holidayAssignment: {
								findMany: vi.fn(async () => mockState.holidayAssignments),
							},
						},
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

vi.mock("./holiday-scope", async () => {
	const { Effect } = await import("effect");

	return {
		getScopedHolidayAccessContext: vi.fn(() =>
			Effect.succeed({
				actor: {
					...mockState.actor,
					dbService: {
						db: {
							query: {
								teamPermissions: {
									findMany: vi.fn(async () => mockState.teamPermissionsRows),
								},
								holidayAssignment: {
									findMany: vi.fn(async () => mockState.holidayAssignments),
								},
							},
						},
						query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
					},
				},
				managedEmployeeIds: mockState.actor.accessTier === "orgAdmin" ? null : mockState.managedEmployeeIds,
				manageableTeamIds:
					mockState.actor.accessTier === "orgAdmin"
						? null
						: new Set(
								mockState.teamPermissionsRows
									.filter((row) => row.canManageTeamSettings && row.teamId)
									.map((row) => row.teamId as string),
						  ),
			}),
		),
		filterAssignmentsForManagerHolidayScope: vi.fn(
			(assignments, manageableTeamIds: Set<string> | null, managedEmployeeIds: Set<string> | null) => {
				if (!manageableTeamIds || !managedEmployeeIds) {
					return assignments;
				}

				return assignments.filter((assignment: any) => {
					if (assignment.assignmentType === "organization") return true;
					if (assignment.assignmentType === "team") {
						return assignment.teamId ? manageableTeamIds.has(assignment.teamId) : false;
					}
					return assignment.employeeId ? managedEmployeeIds.has(assignment.employeeId) : false;
				});
			},
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
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const db = {
		query: {
			teamPermissions: {
				findMany: vi.fn(async () => mockState.teamPermissionsRows),
			},
			holidayAssignment: {
				findMany: vi.fn(async () => mockState.holidayAssignments),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => [{ count: mockState.countResult }]),
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(() => ({
								offset: vi.fn(async () => []),
							})),
						})),
					})),
				})),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn((value: unknown) => ({
				where: vi.fn(async () => {
					mockState.updateCalls.push(value);
				}),
			})),
		})),
	};

	return {
		AppLayer: Layer.mergeAll(
			Layer.succeed(AuthService, {
				getSession: () =>
					Effect.succeed({
						user: mockState.actor.session.user,
						session: { activeOrganizationId: mockState.actor.organizationId },
					}),
			}),
			Layer.succeed(DatabaseService, {
				db,
				query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
			}),
		),
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

					if (error && typeof error === "object" && "message" in error) {
						return {
							success: false as const,
							error: (error as { message: string }).message,
							code: (error as { _tag?: string })._tag,
						};
					}

					return { success: false as const, error: "Unknown error", code: "UNKNOWN_ERROR" };
				},
			});
		},
	};
});

const { deleteHoliday, getHolidayAssignments } = await import("./actions");

describe("holiday settings scope behavior", () => {
	beforeEach(() => {
		mockState.actor = {
			accessTier: "manager",
			organizationId: "org-1",
			dbService: null,
			session: {
				user: {
					id: "user-1",
					email: "manager@example.com",
				},
			},
			currentEmployee: {
				id: "manager-employee-1",
				organizationId: "org-1",
				role: "manager",
			},
		};
		mockState.managedEmployeeIds = new Set(["employee-managed"]);
		mockState.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.updateCalls = [];
	});

	it("lets managers read only organization, managed-team, and managed-employee holiday assignments", async () => {
		const result = await getHolidayAssignments("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((assignment) => assignment.id)).toEqual([
				"assignment-org",
				"assignment-team",
				"assignment-employee",
			]);
		}
	});

	it("rejects direct manager holiday deletions", async () => {
		const result = await deleteHoliday("holiday-org");

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
		expect(result.error).toBe("Only org admins can delete holidays");
		expect(mockState.updateCalls).toEqual([]);
	});
});
