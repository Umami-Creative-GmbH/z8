import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	actor: {
		accessTier: "manager" as "manager" | "orgAdmin",
		organizationId: "org-1",
		session: {
			user: {
				id: "user-1",
				email: "user@example.com",
			},
		},
		currentEmployee: {
			id: "manager-1",
			organizationId: "org-1",
			role: "manager" as const,
		},
	},
	managedEmployeeIds: new Set<string>(["employee-managed"]),
	teamPermissionsRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	presetAssignments: [
		{
			id: "preset-org",
			presetId: "preset-1",
			assignmentType: "organization",
			teamId: null,
			employeeId: null,
			priority: 0,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			preset: {
				id: "preset-1",
				name: "Org preset",
				year: 2026,
				color: null,
				countryCode: "DE",
				stateCode: null,
			},
			team: null,
			employee: null,
		},
		{
			id: "preset-team",
			presetId: "preset-2",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			preset: {
				id: "preset-2",
				name: "Team preset",
				year: 2026,
				color: null,
				countryCode: "DE",
				stateCode: null,
			},
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "preset-employee",
			presetId: "preset-3",
			assignmentType: "employee",
			teamId: null,
			employeeId: "employee-managed",
			priority: 2,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			preset: {
				id: "preset-3",
				name: "Employee preset",
				year: 2026,
				color: null,
				countryCode: "DE",
				stateCode: null,
			},
			team: null,
			employee: { id: "employee-managed", firstName: "Mina", lastName: "Miller" },
		},
		{
			id: "preset-other-team",
			presetId: "preset-4",
			assignmentType: "team",
			teamId: "team-other",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			preset: {
				id: "preset-4",
				name: "Other preset",
				year: 2026,
				color: null,
				countryCode: "DE",
				stateCode: null,
			},
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
	],
	insertedPreset: {
		id: "preset-new",
		organizationId: "org-1",
		name: "Bavaria",
		description: null,
		countryCode: "DE",
		stateCode: "BY",
		regionCode: null,
		year: null,
		color: null,
		isActive: true,
		createdBy: "user-1",
	},
	presetDetail: {
		preset: {
			id: "preset-existing",
			organizationId: "org-1",
			name: "Existing preset",
			description: null,
			countryCode: "DE",
			stateCode: null,
			regionCode: null,
			year: null,
			color: null,
			isActive: true,
		},
		holidays: [],
	},
	insertCalls: [] as Array<any>,
	updateCalls: [] as Array<any>,
	deleteConditions: [] as Array<any>,
	actorContextCalls: [] as Array<any>,
	selectCalls: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	ne: vi.fn((left: unknown, right: unknown) => ({ ne: [left, right] })),
	relations: vi.fn(() => ({})),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "id",
		userId: "userId",
		isActive: "isActive",
		organizationId: "organizationId",
		firstName: "firstName",
		lastName: "lastName",
		position: "position",
	},
	holidayCategory: { id: "id", organizationId: "organizationId", name: "name", color: "color" },
	holidayPreset: {
		id: "id",
		organizationId: "organizationId",
		countryCode: "countryCode",
		stateCode: "stateCode",
		regionCode: "regionCode",
		year: "year",
		name: "name",
		color: "color",
		createdAt: "createdAt",
	},
	holidayPresetAssignment: {
		id: "id",
		presetId: "presetId",
		organizationId: "organizationId",
		assignmentType: "assignmentType",
		teamId: "teamId",
		employeeId: "employeeId",
		priority: "priority",
		effectiveFrom: "effectiveFrom",
		effectiveUntil: "effectiveUntil",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	holidayPresetHoliday: { presetId: "presetId" },
	team: { id: "id", name: "name", organizationId: "organizationId" },
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
		getEmployeeSettingsActorContext: vi.fn((options?: any) => {
			mockState.actorContextCalls.push(options);
			return Effect.succeed({
				...mockState.actor,
				dbService: {
					db: {
						query: {
							teamPermissions: { findMany: vi.fn(async () => mockState.teamPermissionsRows) },
							holidayPresetAssignment: { findMany: vi.fn(async () => mockState.presetAssignments) },
						},
						select: vi.fn((selection?: unknown) => {
							mockState.selectCalls.push(selection);
							if ((selection as { count?: unknown } | undefined)?.count) {
								return {
									from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 0 }]) })),
								};
							}
							return {
								from: vi.fn((table: any) => ({
									where: vi.fn((condition: any) => ({
										limit: vi.fn(async () => {
											const serialized = JSON.stringify(condition);
											if (serialized.includes("countryCode")) {
												return [];
											}
											if (serialized.includes("category-other")) {
												return [];
											}
											if (
												serialized.includes("preset-existing") ||
												table?.organizationId === "organizationId"
											) {
												return [mockState.presetDetail.preset];
											}
											return [];
										}),
									})),
									leftJoin: vi.fn(() => ({
										where: vi.fn(() => ({
											orderBy: vi.fn(async () => mockState.presetDetail.holidays),
										})),
									})),
									orderBy: vi.fn(async () => {
										if (table?.presetId === "presetId") {
											return mockState.presetDetail.holidays;
										}
										return [];
									}),
									innerJoin: vi.fn(() => ({
										where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: "owned-row" }]) })),
										leftJoin: vi.fn(() => ({
											leftJoin: vi.fn(() => ({
												leftJoin: vi.fn(() => ({
													where: vi.fn((condition: any) => ({
														orderBy: vi.fn(async () => {
															const serialized = JSON.stringify(condition);
															if (serialized.includes("preset-existing")) {
																return [];
															}
															return mockState.presetAssignments;
														}),
													})),
												})),
											})),
										})),
									})),
								})),
							};
						}),
						leftJoin: vi.fn(() => ({
							where: vi.fn(() => ({ orderBy: vi.fn(async () => mockState.presetDetail.holidays) })),
						})),
						insert: vi.fn(() => ({
							values: vi.fn((value: unknown) => ({
								returning: vi.fn(async () => {
									mockState.insertCalls.push(value);
									return [mockState.insertedPreset];
								}),
							})),
						})),
						update: vi.fn(() => ({
							set: vi.fn((value: unknown) => ({
								where: vi.fn((condition: unknown) => {
									mockState.updateCalls.push({ value, condition });
									return { returning: vi.fn(async () => [mockState.insertedPreset]) };
								}),
							})),
						})),
						delete: vi.fn(() => ({
							where: vi.fn((condition: unknown) => {
								mockState.deleteConditions.push(condition);
								return { returning: vi.fn(async () => [{ id: "preset-existing" }]) };
							}),
						})),
					},
					query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
				},
			});
		}),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() =>
			Effect.succeed(mockState.managedEmployeeIds),
		),
		requireOrgAdminEmployeeSettingsAccess: vi.fn((actor: any, options: any) =>
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
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const db = {
		query: {
			teamPermissions: { findMany: vi.fn(async () => mockState.teamPermissionsRows) },
			holidayPresetAssignment: { findMany: vi.fn(async () => mockState.presetAssignments) },
		},
		select: vi.fn((selection?: unknown) => {
			mockState.selectCalls.push(selection);
			if ((selection as { count?: unknown } | undefined)?.count) {
				return {
					from: vi.fn(() => ({ where: vi.fn(async () => [{ count: 0 }]) })),
				};
			}
			return {
				from: vi.fn((table: any) => ({
					where: vi.fn((condition: any) => ({
						limit: vi.fn(async () => {
							const serialized = JSON.stringify(condition);
							if (serialized.includes("countryCode")) {
								return [];
							}
							if (
								serialized.includes("preset-existing") ||
								table?.organizationId === "organizationId"
							) {
								return [mockState.presetDetail.preset];
							}
							return [];
						}),
					})),
					leftJoin: vi.fn(() => ({
						where: vi.fn(() => ({ orderBy: vi.fn(async () => mockState.presetDetail.holidays) })),
					})),
					orderBy: vi.fn(async () => {
						if (table?.presetId === "presetId") {
							return mockState.presetDetail.holidays;
						}
						return [];
					}),
					innerJoin: vi.fn(() => ({
						leftJoin: vi.fn(() => ({
							leftJoin: vi.fn(() => ({
								leftJoin: vi.fn(() => ({
									where: vi.fn((condition: any) => ({
										orderBy: vi.fn(async () => {
											const serialized = JSON.stringify(condition);
											if (serialized.includes("preset-existing")) {
												return [];
											}
											return mockState.presetAssignments;
										}),
									})),
								})),
							})),
						})),
					})),
				})),
				leftJoin: vi.fn(() => ({
					where: vi.fn(() => ({ orderBy: vi.fn(async () => mockState.presetDetail.holidays) })),
				})),
			};
		}),
		insert: vi.fn(() => ({
			values: vi.fn((value: unknown) => ({
				returning: vi.fn(async () => {
					mockState.insertCalls.push(value);
					return [mockState.insertedPreset];
				}),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn((value: unknown) => ({
				where: vi.fn((condition: unknown) => {
					mockState.updateCalls.push({ value, condition });
					return { returning: vi.fn(async () => [mockState.insertedPreset]) };
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn((condition: unknown) => {
				mockState.deleteConditions.push(condition);
				return { returning: vi.fn(async () => [{ id: "preset-existing" }]) };
			}),
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

const { assignmentRangesOverlap, buildPresetLocationConflictConditions } = await import(
	"./preset-scheduling"
);
const {
	createHolidayPreset,
	createPresetAssignment,
	addHolidayToPreset,
	bulkAddHolidaysToPreset,
	deleteHolidayPreset,
	deleteHolidayFromPreset,
	deletePresetAssignment,
	getEmployeesForAssignment,
	getHolidayPreset,
	getHolidayPresets,
	getPresetAssignments,
	getTeamsForAssignment,
	updateHolidayPreset,
} = await import("./preset-actions");

describe("holiday preset settings scope behavior", () => {
	beforeEach(() => {
		mockState.actor = {
			accessTier: "manager",
			organizationId: "org-1",
			session: { user: { id: "user-1", email: "user@example.com" } },
			currentEmployee: { id: "manager-1", organizationId: "org-1", role: "manager" },
		};
		mockState.managedEmployeeIds = new Set(["employee-managed"]);
		mockState.teamPermissionsRows = [{ teamId: "team-managed", canManageTeamSettings: true }];
		mockState.insertCalls = [];
		mockState.updateCalls = [];
		mockState.deleteConditions = [];
		mockState.actorContextCalls = [];
		mockState.selectCalls = [];
	});

	it("lets managers read only organization, managed-team, and managed-employee preset assignments", async () => {
		const result = await getPresetAssignments("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((assignment) => assignment.id)).toEqual([
				"preset-org",
				"preset-team",
				"preset-employee",
			]);
			expect(result.data[0]?.preset.year).toBe(2026);
		}
		expect(mockState.selectCalls).toContainEqual(
			expect.objectContaining({
				preset: expect.objectContaining({ year: "year" }),
			}),
		);
	});

	it("lets owners create holiday presets with org-admin parity even without an admin employee row", async () => {
		mockState.actor = {
			accessTier: "orgAdmin",
			organizationId: "org-1",
			session: { user: { id: "user-1", email: "owner@example.com" } },
			currentEmployee: null,
		};

		const result = await createHolidayPreset("org-1", {
			name: "Bavaria",
			description: "",
			countryCode: "DE",
			stateCode: "BY",
			regionCode: "",
			color: "",
			isActive: true,
		});

		expect(result.success).toBe(true);
		expect(mockState.insertCalls).toHaveLength(1);
	});

	it("rejects managers reading holiday presets outside their holiday assignment scope", async () => {
		const result = await getHolidayPreset("preset-existing");

		expect(result.success).toBe(false);
		expect(result.error).toBe("Preset not found");
	});

	it("lets owners read holiday presets with org-admin parity even without an employee row", async () => {
		mockState.actor = {
			accessTier: "orgAdmin",
			organizationId: "org-1",
			session: { user: { id: "user-1", email: "owner@example.com" } },
			currentEmployee: null,
		};

		const result = await getHolidayPreset("preset-existing");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.preset.id).toBe("preset-existing");
		}
	});

	it("uses actor organization context for preset and assignment helper reads", async () => {
		await getHolidayPresets("org-1");
		await getTeamsForAssignment("org-1");
		await getEmployeesForAssignment("org-1");

		expect(mockState.actorContextCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ organizationId: "org-1", queryName: "getHolidayPresets:actor" }),
				expect.objectContaining({
					organizationId: "org-1",
					queryName: "getTeamsForAssignment:actor",
				}),
				expect.objectContaining({
					organizationId: "org-1",
					queryName: "getEmployeesForAssignment:actor",
				}),
			]),
		);
	});

	it("persists the existing preset year when updating preset details", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await updateHolidayPreset("preset-existing", {
			name: "Existing preset",
			description: "",
			countryCode: "DE",
			stateCode: "",
			regionCode: "",
			year: 2027,
			color: "",
			isActive: true,
		});

		expect(result.success).toBe(true);
		expect(mockState.updateCalls[0]?.value).toEqual(expect.objectContaining({ year: 2027 }));
	});

	it("verifies preset assignments and deletes against the actor organization", async () => {
		mockState.actor.accessTier = "orgAdmin";

		await createPresetAssignment("org-1", {
			presetId: "preset-existing",
			assignmentType: "team",
			teamId: "team-managed",
			employeeId: null,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
		});
		await deletePresetAssignment("assignment-1");

		expect(JSON.stringify(mockState.updateCalls.at(-1)?.condition)).toContain("org-1");
	});

	it("verifies preset holiday ownership before deleting", async () => {
		mockState.actor.accessTier = "orgAdmin";

		await deleteHolidayFromPreset("holiday-1");

		expect(mockState.deleteConditions).toHaveLength(1);
		expect(mockState.selectCalls.length).toBeGreaterThan(0);
	});

	it("hard deletes holiday presets instead of only marking them inactive", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await deleteHolidayPreset("preset-existing");

		expect(result.success).toBe(true);
		expect(mockState.deleteConditions).toHaveLength(1);
		expect(mockState.updateCalls).toHaveLength(0);
	});

	it("rejects adding preset holidays with a category from another organization", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await addHolidayToPreset("preset-existing", {
			name: "Holiday",
			description: "",
			month: 1,
			day: 1,
			durationDays: 1,
			holidayType: "public",
			isFloating: false,
			floatingRule: null,
			categoryId: "category-other",
			isActive: true,
		});

		expect(result.success).toBe(false);
		expect(result.error).toBe("Holiday category not found");
		expect(mockState.insertCalls).toHaveLength(0);
	});

	it("rejects bulk adding preset holidays with a category from another organization", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await bulkAddHolidaysToPreset(
			"preset-existing",
			[
				{
					name: "Holiday",
					description: "",
					month: 1,
					day: 1,
					durationDays: 1,
					holidayType: "public",
					isFloating: false,
					floatingRule: null,
					isActive: true,
				},
			],
			"category-other",
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe("Holiday category not found");
		expect(mockState.insertCalls).toHaveLength(0);
	});
});

describe("holiday preset scheduling behavior", () => {
	it("treats adjacent calendar-year assignment ranges as non-overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(false);
	});

	it("treats overlapping assignment ranges as overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2026-06-01T00:00:00.000Z"),
				new Date("2027-05-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("treats open-ended ranges as unbounded", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				null,
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("includes year in imported preset location conflict checks", () => {
		const conditions = buildPresetLocationConflictConditions("org-1", {
			countryCode: "DE",
			stateCode: "BY",
			regionCode: undefined,
			year: 2027,
		});

		expect(conditions).toHaveLength(5);
		expect(conditions).toContainEqual({ eq: ["year", 2027] });
	});

	it("excludes the current preset from update location conflict checks", () => {
		const conditions = buildPresetLocationConflictConditions(
			"org-1",
			{
				countryCode: "DE",
				stateCode: "BY",
				regionCode: undefined,
				year: 2027,
			},
			{ excludePresetId: "preset-current" },
		);

		expect(conditions).toContainEqual({ ne: ["id", "preset-current"] });
	});
});
