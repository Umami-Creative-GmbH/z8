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
			preset: { id: "preset-1", name: "Org preset", color: null, countryCode: "DE", stateCode: null },
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
			preset: { id: "preset-2", name: "Team preset", color: null, countryCode: "DE", stateCode: null },
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
			preset: { id: "preset-3", name: "Employee preset", color: null, countryCode: "DE", stateCode: null },
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
			preset: { id: "preset-4", name: "Other preset", color: null, countryCode: "DE", stateCode: null },
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
			color: null,
			isActive: true,
		},
		holidays: [],
	},
	insertCalls: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", userId: "userId", isActive: "isActive", organizationId: "organizationId", firstName: "firstName", lastName: "lastName", position: "position" },
	holidayCategory: { id: "id", name: "name", color: "color" },
	holidayPreset: { id: "id", organizationId: "organizationId", countryCode: "countryCode", stateCode: "stateCode", regionCode: "regionCode", name: "name", color: "color", createdAt: "createdAt" },
	holidayPresetAssignment: { id: "id", presetId: "presetId", organizationId: "organizationId", assignmentType: "assignmentType", teamId: "teamId", employeeId: "employeeId", priority: "priority", effectiveFrom: "effectiveFrom", effectiveUntil: "effectiveUntil", isActive: "isActive", createdAt: "createdAt" },
	holidayPresetHoliday: { presetId: "presetId" },
	team: { id: "id", name: "name", organizationId: "organizationId" },
	teamPermissions: { employeeId: "employeeId", organizationId: "organizationId", teamId: "teamId", canManageTeamSettings: "canManageTeamSettings" },
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
							teamPermissions: { findMany: vi.fn(async () => mockState.teamPermissionsRows) },
							holidayPresetAssignment: { findMany: vi.fn(async () => mockState.presetAssignments) },
						},
						select: vi.fn(() => ({
							from: vi.fn((table: any) => ({
								where: vi.fn((condition: any) => ({
									limit: vi.fn(async () => {
										const serialized = JSON.stringify(condition);
										if (serialized.includes("countryCode")) {
											return [];
										}
										if (serialized.includes("preset-existing") || table?.organizationId === "organizationId") {
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
						insert: vi.fn(() => ({
							values: vi.fn((value: unknown) => ({
								returning: vi.fn(async () => {
									mockState.insertCalls.push(value);
									return [mockState.insertedPreset];
								}),
							})),
						})),
						update: vi.fn(() => ({
							set: vi.fn(() => ({
								where: vi.fn(() => ({ returning: vi.fn(async () => [mockState.insertedPreset]) })),
							})),
						})),
					},
					query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
				},
			}),
		),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() => Effect.succeed(mockState.managedEmployeeIds)),
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
		select: vi.fn(() => ({
			from: vi.fn((table: any) => ({
				where: vi.fn((condition: any) => ({
					limit: vi.fn(async () => {
						const serialized = JSON.stringify(condition);
						if (serialized.includes("countryCode")) {
							return [];
						}
						if (serialized.includes("preset-existing") || table?.organizationId === "organizationId") {
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
			leftJoin: vi.fn(() => ({
				where: vi.fn(() => ({ orderBy: vi.fn(async () => mockState.presetDetail.holidays) })),
			})),
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
			set: vi.fn(() => ({
				where: vi.fn(() => ({ returning: vi.fn(async () => [mockState.insertedPreset]) })),
			})),
		})),
	};

	return {
		AppLayer: Layer.mergeAll(
			Layer.succeed(AuthService, {
				getSession: () => Effect.succeed({ user: mockState.actor.session.user, session: { activeOrganizationId: mockState.actor.organizationId } }),
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

const { createHolidayPreset, getPresetAssignments } = await import("./preset-actions");
const { getHolidayPreset } = await import("./preset-actions");

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
		}
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
});
