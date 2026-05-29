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
	holidayCategoryAssignments: [
		{
			id: "category-assignment-org",
			categoryId: "category-org",
			organizationId: "org-1",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			category: { id: "category-org", name: "Org Category", type: "custom", color: "#123456" },
			team: null,
			employee: null,
		},
		{
			id: "category-assignment-team",
			categoryId: "category-team",
			organizationId: "org-1",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			category: { id: "category-team", name: "Team Category", type: "custom", color: "#654321" },
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "category-assignment-employee",
			categoryId: "category-employee",
			organizationId: "org-1",
			assignmentType: "employee",
			teamId: null,
			employeeId: "employee-managed",
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			category: { id: "category-employee", name: "Employee Category", type: "custom", color: null },
			team: null,
			employee: {
				id: "employee-managed",
				user: { firstName: "Mina", lastName: "Miller" },
			},
		},
		{
			id: "category-assignment-other-team",
			categoryId: "category-other-team",
			organizationId: "org-1",
			assignmentType: "team",
			teamId: "team-other",
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			category: {
				id: "category-other-team",
				name: "Other Team Category",
				type: "custom",
				color: null,
			},
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
		{
			id: "category-assignment-other-org",
			categoryId: "category-other-org",
			organizationId: "org-2",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			isActive: true,
			createdAt: new Date("2026-01-05T00:00:00.000Z"),
			category: {
				id: "category-other-org",
				name: "Other Org Category",
				type: "custom",
				color: null,
			},
			team: null,
			employee: null,
		},
	],
	countResult: 4,
	holidayRows: [{ id: "holiday-org", organizationId: "org-1" }],
	holidayCategoryRows: [{ id: "category-org", organizationId: "org-1", isActive: true }],
	teamRows: [{ id: "team-managed", organizationId: "org-1" }],
	employeeRows: [{ id: "employee-managed", organizationId: "org-1" }],
	deleteCalls: [] as Array<any>,
	insertCalls: [] as Array<any>,
	updateCalls: [] as Array<any>,
	updateReturnRows: [{ id: "category-assignment-org" }],
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
	employee: { __name: "employee", id: "id", organizationId: "organizationId" },
	holiday: {
		__name: "holiday",
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		categoryId: "categoryId",
		name: "name",
		description: "description",
		startDate: "startDate",
	},
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
	holidayCategory: {
		__name: "holidayCategory",
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		name: "name",
	},
	holidayCategoryAssignment: {
		__name: "holidayCategoryAssignment",
		id: "id",
		categoryId: "categoryId",
		organizationId: "organizationId",
		assignmentType: "assignmentType",
		teamId: "teamId",
		employeeId: "employeeId",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	team: { __name: "team", id: "id", name: "name", organizationId: "organizationId" },
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
							holidayCategoryAssignment: {
								findMany: vi.fn(async () =>
									mockState.holidayCategoryAssignments.filter(
										(assignment) => assignment.organizationId === mockState.actor.organizationId,
									),
								),
							},
						},
						select: vi.fn(() => ({
							from: vi.fn((table: any) => ({
								where: vi.fn(() => ({
									limit: vi.fn(async () => {
										if (table.__name === "holidayCategory") return mockState.holidayCategoryRows;
										if (table.__name === "team") return mockState.teamRows;
										if (table.__name === "employee") return mockState.employeeRows;
										return mockState.holidayRows;
									}),
								})),
							})),
						})),
						insert: vi.fn((table: any) => ({
							values: vi.fn((value: unknown) => {
								mockState.insertCalls.push({ table: table.__name, value });
								return {
									returning: vi.fn(async () => [
										{ id: "new-category-assignment", ...(value as object) },
									]),
								};
							}),
						})),
						delete: vi.fn((table: unknown) => ({
							where: vi.fn((condition: unknown) => {
								mockState.deleteCalls.push({ table, condition });
								return {
									returning: vi.fn(async () => [{ id: "holiday-org" }, { id: "holiday-team" }]),
								};
							}),
						})),
						update: vi.fn((table: any) => ({
							set: vi.fn((value: unknown) => ({
								where: vi.fn((condition: unknown) => {
									mockState.updateCalls.push({ table: table.__name, value, condition });
									return {
										returning: vi.fn(async () => mockState.updateReturnRows),
									};
								}),
							})),
						})),
					},
					query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
				},
			}),
		),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() =>
			Effect.succeed(mockState.managedEmployeeIds),
		),
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
								holidayCategoryAssignment: {
									findMany: vi.fn(async () =>
										mockState.holidayCategoryAssignments.filter(
											(assignment) => assignment.organizationId === mockState.actor.organizationId,
										),
									),
								},
							},
						},
						query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
					},
				},
				managedEmployeeIds:
					mockState.actor.accessTier === "orgAdmin" ? null : mockState.managedEmployeeIds,
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
			(
				assignments,
				manageableTeamIds: Set<string> | null,
				managedEmployeeIds: Set<string> | null,
			) => {
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

const {
	bulkDeleteHolidays,
	createHolidayCategoryAssignment,
	deleteHoliday,
	deleteHolidayCategoryAssignment,
	getHolidayAssignments,
	getHolidayCategoryAssignments,
} = await import("./actions");

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
		mockState.holidayRows = [{ id: "holiday-org", organizationId: "org-1" }];
		mockState.holidayCategoryRows = [
			{ id: "category-org", organizationId: "org-1", isActive: true },
		];
		mockState.teamRows = [{ id: "team-managed", organizationId: "org-1" }];
		mockState.employeeRows = [{ id: "employee-managed", organizationId: "org-1" }];
		mockState.deleteCalls = [];
		mockState.insertCalls = [];
		mockState.updateCalls = [];
		mockState.updateReturnRows = [{ id: "category-assignment-org" }];
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

	it("lets managers read only organization, managed-team, and managed-employee holiday category assignments", async () => {
		const result = await getHolidayCategoryAssignments("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((assignment) => assignment.id)).toEqual([
				"category-assignment-org",
				"category-assignment-team",
				"category-assignment-employee",
			]);
			expect(result.data[2]?.employee).toMatchObject({
				id: "employee-managed",
				firstName: "Mina",
				lastName: "Miller",
			});
		}
	});

	it("creates organization-scoped holiday category assignments for org admins", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: "employee-managed",
		});

		expect(result.success).toBe(true);
		expect(mockState.insertCalls).toEqual([
			{
				table: "holidayCategoryAssignment",
				value: {
					categoryId: "category-org",
					organizationId: "org-1",
					assignmentType: "team",
					teamId: "team-managed",
					employeeId: null,
					createdBy: "user-1",
				},
			},
		]);
	});

	it("rejects cross-org and inactive holiday category IDs before insert", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.holidayCategoryRows = [];

		const result = await createHolidayCategoryAssignment({
			categoryId: "category-other-org",
			assignmentType: "organization",
		});

		expect(result.success).toBe(false);
		expect(result.code).toBe("NotFoundError");
		expect(result.error).toBe("Holiday category not found");
		expect(mockState.insertCalls).toEqual([]);
	});

	it("rejects cross-org team and employee IDs before insert", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.teamRows = [];

		const teamResult = await createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "team",
			teamId: "team-other-org",
		});

		expect(teamResult.success).toBe(false);
		expect(teamResult.code).toBe("NotFoundError");
		expect(teamResult.error).toBe("Team not found");
		expect(mockState.insertCalls).toEqual([]);

		mockState.teamRows = [{ id: "team-managed", organizationId: "org-1" }];
		mockState.employeeRows = [];

		const employeeResult = await createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "employee",
			employeeId: "employee-other-org",
		});

		expect(employeeResult.success).toBe(false);
		expect(employeeResult.code).toBe("NotFoundError");
		expect(employeeResult.error).toBe("Employee not found");
		expect(mockState.insertCalls).toEqual([]);
	});

	it("soft deletes holiday category assignments only in the admin organization", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await deleteHolidayCategoryAssignment("category-assignment-org");

		expect(result.success).toBe(true);
		expect(mockState.updateCalls).toEqual([
			expect.objectContaining({
				table: "holidayCategoryAssignment",
				value: { isActive: false },
				condition: expect.objectContaining({ and: expect.any(Array) }),
			}),
		]);

		mockState.updateCalls = [];
		mockState.updateReturnRows = [];

		const missingResult = await deleteHolidayCategoryAssignment("category-assignment-other-org");

		expect(missingResult.success).toBe(false);
		expect(missingResult.code).toBe("NotFoundError");
		expect(missingResult.error).toBe("Holiday category assignment not found");
	});

	it("rejects manager holiday category assignment mutations", async () => {
		const createResult = await createHolidayCategoryAssignment({
			categoryId: "category-org",
			assignmentType: "organization",
		});
		const deleteResult = await deleteHolidayCategoryAssignment("category-assignment-org");

		expect(createResult.success).toBe(false);
		expect(createResult.code).toBe("AuthorizationError");
		expect(createResult.error).toBe("Only org admins can create holiday category assignments");
		expect(deleteResult.success).toBe(false);
		expect(deleteResult.code).toBe("AuthorizationError");
		expect(deleteResult.error).toBe("Only org admins can delete holiday category assignments");
		expect(mockState.insertCalls).toEqual([]);
		expect(mockState.updateCalls).toEqual([]);
	});

	it("rejects direct manager holiday deletions", async () => {
		const result = await deleteHoliday("holiday-org");

		expect(result.success).toBe(false);
		expect(result.code).toBe("AuthorizationError");
		expect(result.error).toBe("Only org admins can delete holidays");
		expect(mockState.updateCalls).toEqual([]);
	});

	it("hard deletes holidays for org admins", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await deleteHoliday("holiday-org");

		expect(result.success).toBe(true);
		expect(mockState.deleteCalls).toHaveLength(1);
		expect(mockState.updateCalls).toEqual([]);
	});

	it("hard deletes multiple holidays for org admins", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await bulkDeleteHolidays(["holiday-org", "holiday-team"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.deleted).toBe(2);
		}
		expect(mockState.deleteCalls).toHaveLength(1);
		expect(mockState.updateCalls).toEqual([]);
	});
});
