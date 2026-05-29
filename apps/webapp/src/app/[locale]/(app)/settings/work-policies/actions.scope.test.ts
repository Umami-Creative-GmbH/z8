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
	},
	session: {
		user: {
			id: "user-1",
			email: "manager@example.com",
		},
		session: {
			activeOrganizationId: "org-1",
		},
	},
	targetEmployee: {
		id: "employee-1",
		organizationId: "org-1",
		role: "employee" as const,
	},
	managedEmployeeIds: new Set<string>(["employee-1"]),
	isOrgAdmin: false,
	workPolicies: [{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true }],
	workPolicyQueue: [] as Array<any>,
	workPolicyPresets: [] as Array<any>,
	workPolicyPresetQueue: [] as Array<any>,
	workPolicyPresetFindFirstArgs: [] as Array<any>,
	assignmentQueue: [] as Array<any>,
	employeeQueue: [] as Array<any>,
	teamQueue: [] as Array<any>,
	assignmentFindFirstArgs: [] as Array<any>,
	violationRows: [{ id: "violation-1", organizationId: "org-1" }],
	insertQueue: [] as Array<any>,
	insertValues: [] as Array<any>,
	selectQueue: [] as Array<any>,
	selectWhereArgs: [] as Array<any>,
	updateQueue: [] as Array<any>,
	updateSets: [] as Array<any>,
	updateWhereArgs: [] as Array<any>,
	markOrganizationWorkBalancesDirty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	desc: vi.fn((value: unknown) => value),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	or: vi.fn((...args: unknown[]) => ({ or: args })),
	sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
		sql: Array.from(strings),
		values,
	})),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", userId: "userId", isActive: "isActive", organizationId: "organizationId" },
	team: { id: "id", organizationId: "organizationId", name: "name" },
	workPolicy: { id: "id", organizationId: "organizationId", isActive: "isActive", name: "name" },
	workPolicyAssignment: {
		id: "id",
		organizationId: "organizationId",
		employeeId: "employeeId",
		assignmentType: "assignmentType",
		isActive: "isActive",
		effectiveFrom: "effectiveFrom",
		effectiveUntil: "effectiveUntil",
		createdAt: "createdAt",
		teamId: "teamId",
	},
	workPolicyBreakOption: { sortOrder: "sortOrder" },
	workPolicyBreakRule: { sortOrder: "sortOrder" },
	workPolicyPresence: {},
	workPolicyPreset: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		name: "name",
		description: "description",
		countryCode: "countryCode",
		scheduleCycle: "scheduleCycle",
		workingDaysPreset: "workingDaysPreset",
		hoursPerCycle: "hoursPerCycle",
		maxDailyMinutes: "maxDailyMinutes",
		maxWeeklyMinutes: "maxWeeklyMinutes",
		maxUninterruptedMinutes: "maxUninterruptedMinutes",
		breakRulesJson: "breakRulesJson",
	},
	workPolicyRegulation: {},
	workPolicySchedule: {},
	workPolicyScheduleDay: {},
	workPolicyViolation: {
		id: "id",
		organizationId: "organizationId",
		violationDate: "violationDate",
	},
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: vi.fn(async () => mockState.isOrgAdmin),
}));

vi.mock("@/lib/work-balance/service", () => ({
	markOrganizationWorkBalancesDirty: mockState.markOrganizationWorkBalancesDirty,
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	currentTimestamp: () => new Date("2026-01-01T00:00:00.000Z"),
}));

vi.mock("../employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError, NotFoundError, ValidationError } = await import(
		"@/lib/effect/errors"
	);

	return {
		getEmployeeSettingsActorContext: vi.fn(() => Effect.succeed(mockState.actor)),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() =>
			Effect.succeed(mockState.managedEmployeeIds),
		),
		validateAssignmentTargetFields: vi.fn(
			(assignmentType: string, input: { teamId?: string; employeeId?: string }) => {
				const hasTeamId = Boolean(input.teamId);
				const hasEmployeeId = Boolean(input.employeeId);
				if (assignmentType === "organization") {
					return hasTeamId || hasEmployeeId
						? Effect.fail(
								new ValidationError({
									message: "Organization assignments cannot target teams or employees",
									field: hasTeamId ? "teamId" : "employeeId",
								}),
							)
						: Effect.void;
				}
				if (assignmentType === "team") {
					if (!hasTeamId) {
						return Effect.fail(
							new ValidationError({
								message: "Team assignments require a teamId",
								field: "teamId",
							}),
						);
					}
					return hasEmployeeId
						? Effect.fail(
								new ValidationError({
									message: "Team assignments cannot target an employee",
									field: "employeeId",
								}),
							)
						: Effect.void;
				}
				if (!hasEmployeeId) {
					return Effect.fail(
						new ValidationError({
							message: "Employee assignments require an employeeId",
							field: "employeeId",
						}),
					);
				}
				return hasTeamId
					? Effect.fail(
							new ValidationError({
								message: "Employee assignments cannot target a team",
								field: "teamId",
							}),
						)
					: Effect.void;
			},
		),
		getOrganizationTeam: vi.fn((_teamId: string, _organizationId: string) =>
			mockState.teamQueue[0]
				? Effect.succeed(mockState.teamQueue.shift())
				: Effect.fail(
						new NotFoundError({
							message: "Team not found",
							entityType: "team",
							entityId: "team-outside-org",
						}),
					),
		),
		getTargetEmployee: vi.fn(() => Effect.succeed(mockState.targetEmployee)),
		requireSettingsActorEmployeeRecord: vi.fn((actor: typeof mockState.actor) =>
			actor.currentEmployee
				? Effect.succeed(actor.currentEmployee)
				: Effect.fail(
						new NotFoundError({
							message: "Employee profile not found",
							entityType: "employee",
							entityId: actor.session.user.id,
						}),
					),
		),
		filterItemsToManagedEmployees: vi.fn((items: any[], managedIds: Set<string> | null) =>
			managedIds
				? items.filter((item) => managedIds.has(item.employeeId ?? item.employee?.id))
				: items,
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
		ensureSettingsActorCanAccessEmployeeTarget: vi.fn(
			(actor: typeof mockState.actor, target: any, options: any) =>
				actor.organizationId === target.organizationId &&
				(actor.accessTier === "orgAdmin" || mockState.managedEmployeeIds.has(target.id))
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
		requireSettingsActorEmployeeAssignmentAccess: vi.fn(
			(actor: typeof mockState.actor, assignmentType: string, options: any) =>
				actor.accessTier === "orgAdmin" || assignmentType === "employee"
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

	const authLayer = Layer.succeed(AuthService, {
		getSession: () => Effect.succeed(mockState.session),
	});

	const db = {
		query: {
			workPolicy: {
				findMany: vi.fn(async () => mockState.workPolicies),
				findFirst: vi.fn(async () => mockState.workPolicyQueue.shift() ?? null),
			},
			workPolicyViolation: {
				findMany: vi.fn(async () => mockState.violationRows),
			},
			workPolicyPreset: {
				findFirst: vi.fn(async (input) => {
					mockState.workPolicyPresetFindFirstArgs.push(input);
					return mockState.workPolicyPresetQueue.shift() ?? null;
				}),
				findMany: vi.fn(async () => mockState.workPolicyPresets),
			},
			team: {
				findMany: vi.fn(async () => []),
				findFirst: vi.fn(async () => mockState.teamQueue.shift() ?? null),
			},
			workPolicyAssignment: {
				findMany: vi.fn(async () => []),
				findFirst: vi.fn(async (input) => {
					mockState.assignmentFindFirstArgs.push(input);
					return mockState.assignmentQueue.shift() ?? null;
				}),
			},
			employee: {
				findFirst: vi.fn(async () => mockState.employeeQueue.shift() ?? null),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn((input: unknown) => {
					mockState.selectWhereArgs.push(input);
					return {
						limit: vi.fn(async () => mockState.selectQueue.shift() ?? []),
					};
				}),
			})),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((input: unknown) => {
				mockState.insertValues.push(input);
				return {
					returning: vi.fn(async () => mockState.insertQueue.shift() ?? []),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn((input: unknown) => {
				mockState.updateSets.push(input);
				return {
					where: vi.fn(async (input: unknown) => {
						mockState.updateWhereArgs.push(input);
						return mockState.updateQueue.shift() ?? undefined;
					}),
				};
			}),
		})),
		delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
	};

	const databaseLayer = Layer.succeed(DatabaseService, {
		db,
		query: (_key: string, fn: () => Promise<unknown>) => Effect.promise(fn),
	});

	return {
		AppLayer: Layer.mergeAll(authLayer, databaseLayer),
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

					return { success: false as const, error: "Unknown error", code: "UNKNOWN_ERROR" };
				},
			});
		},
	};
});

const {
	acknowledgeWorkPolicyViolation,
	createWorkPolicy,
	createWorkPolicyAssignment,
	deleteWorkPolicy,
	deleteWorkPolicyAssignment,
	getEmployeeEffectiveScheduleDetails,
	getWorkPolicies,
	getWorkPolicyViolations,
	importWorkPolicyPreset,
	setDefaultWorkPolicy,
	archiveWorkPolicyPreset,
	copySystemWorkPolicyPreset,
	createWorkPolicyFromPreset,
	createWorkPolicyPreset,
	getWorkPolicyPresets,
	updateWorkPolicyPreset,
	updateWorkPolicy,
} = await import("./actions");

describe("work policy settings scope actions", () => {
	beforeEach(() => {
		mockState.actor.accessTier = "manager";
		mockState.actor.currentEmployee = {
			id: "manager-employee-1",
			organizationId: "org-1",
			role: "manager",
		};
		mockState.managedEmployeeIds = new Set(["employee-1"]);
		mockState.isOrgAdmin = false;
		mockState.targetEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		};
		mockState.workPolicies = [
			{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true },
		];
		mockState.workPolicyQueue = [];
		mockState.workPolicyPresets = [];
		mockState.workPolicyPresetQueue = [];
		mockState.workPolicyPresetFindFirstArgs = [];
		mockState.assignmentQueue = [];
		mockState.employeeQueue = [];
		mockState.teamQueue = [];
		mockState.assignmentFindFirstArgs = [];
		mockState.insertQueue = [];
		mockState.insertValues = [];
		mockState.selectQueue = [];
		mockState.selectWhereArgs = [];
		mockState.updateQueue = [];
		mockState.updateSets = [];
		mockState.updateWhereArgs = [];
		mockState.markOrganizationWorkBalancesDirty.mockClear();
		mockState.markOrganizationWorkBalancesDirty.mockResolvedValue(undefined);
	});

	it("lets managers read work policy definitions", async () => {
		const result = await getWorkPolicies("org-1");

		expect(result).toEqual({ success: true, data: mockState.workPolicies });
	});

	it("returns active system and organization work policy presets with source labels", async () => {
		mockState.workPolicyPresets = [
			{ id: "system-preset", organizationId: null, name: "EU Standard", isActive: true },
			{ id: "custom-preset", organizationId: "org-1", name: "Warehouse", isActive: true },
		];

		const result = await getWorkPolicyPresets("org-1");

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: "system-preset",
					organizationId: null,
					name: "EU Standard",
					isActive: true,
					source: "system",
					sourceLabel: "System",
				},
				{
					id: "custom-preset",
					organizationId: "org-1",
					name: "Warehouse",
					isActive: true,
					source: "custom",
					sourceLabel: "Custom",
				},
			],
		});
	});

	it("rejects non-admin custom work policy preset creation", async () => {
		const result = await createWorkPolicyPreset("org-1", {
			name: "Warehouse",
			description: "Warehouse hours",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertValues).toHaveLength(0);
	});

	it("rejects archiving system work policy presets", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "EU Standard", isActive: true },
		];

		const result = await archiveWorkPolicyPreset("org-1", "system-preset");

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.updateSets).toHaveLength(0);
	});

	it("rejects archiving and updating other-organization work policy presets", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "other-preset", organizationId: "org-2", name: "Other", isActive: true },
			{ id: "other-preset", organizationId: "org-2", name: "Other", isActive: true },
		];

		const archiveResult = await archiveWorkPolicyPreset("org-1", "other-preset");
		const updateResult = await updateWorkPolicyPreset("org-1", "other-preset", {
			name: "Updated Other",
			description: "Still outside org",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(archiveResult).toMatchObject({ success: false, code: "NotFoundError" });
		expect(updateResult).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.updateSets).toHaveLength(0);
	});

	it("returns a conflict for duplicate active organization work policy preset names", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "existing-preset", organizationId: "org-1", name: "Warehouse", isActive: true },
		];

		const result = await createWorkPolicyPreset("org-1", {
			name: " Warehouse ",
			description: "Duplicate",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(mockState.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when creating", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await createWorkPolicyPreset("org-1", {
			name: "Warehouse",
			description: "Duplicate archived name",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).not.toContain(
			"isActive",
		);
		expect(mockState.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when copying system presets", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "System Source", isActive: true },
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await copySystemWorkPolicyPreset("org-1", "system-preset", {
			name: "Warehouse",
			description: "Duplicate archived name",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("isActive");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain(
			"isNull",
		);
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[1].where)).not.toContain(
			"isActive",
		);
		expect(mockState.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when updating", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "custom-preset", organizationId: "org-1", name: "Current", isActive: true },
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await updateWorkPolicyPreset("org-1", "custom-preset", {
			name: "Warehouse",
			description: "Duplicate archived name",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("org-1");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[1].where)).not.toContain(
			"isActive",
		);
		expect(mockState.updateSets).toHaveLength(0);
	});

	it("scopes custom preset update and archive lookups to the current organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [null, null];

		await updateWorkPolicyPreset("org-1", "missing-preset", {
			name: "Warehouse",
			description: "Missing",
			scheduleEnabled: true,
			regulationEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});
		await archiveWorkPolicyPreset("org-1", "missing-preset");

		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("org-1");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain(
			"missing-preset",
		);
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[1].where)).toContain("org-1");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[1].where)).toContain(
			"missing-preset",
		);
	});

	it("scopes compatibility import preset lookup to active visible presets", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [null];

		const result = await importWorkPolicyPreset("org-1", "missing-preset");

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain(
			"missing-preset",
		);
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("isActive");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("isNull");
		expect(JSON.stringify(mockState.workPolicyPresetFindFirstArgs[0].where)).toContain("org-1");
	});

	it("creates a real work policy from reviewed preset input and marks balances dirty", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.isOrgAdmin = true;
		mockState.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "Source", isActive: true },
		];
		mockState.workPolicyQueue = [
			null,
			{
				id: "policy-from-preset",
				organizationId: "org-1",
				name: "Reviewed Policy",
				schedule: null,
				regulation: null,
				presence: null,
			},
		];
		mockState.insertQueue = [
			[{ id: "policy-from-preset" }],
			[{ id: "regulation-1" }],
			[{ id: "break-rule-1" }],
		];

		const result = await createWorkPolicyFromPreset(
			"org-1",
			"system-preset",
			{
				name: " Reviewed Policy ",
				description: " Reviewed description ",
				scheduleEnabled: false,
				regulationEnabled: true,
				regulation: {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: 2400,
					breakRules: [
						{
							workingMinutesThreshold: 360,
							requiredBreakMinutes: 30,
							options: [],
						},
					],
				},
			},
		);

		expect(result).toEqual({
			success: true,
			data: {
				id: "policy-from-preset",
				organizationId: "org-1",
				name: "Reviewed Policy",
				schedule: null,
				regulation: null,
				presence: null,
			},
		});
		expect(mockState.insertValues[0]).toMatchObject({
			organizationId: "org-1",
			name: "Reviewed Policy",
			description: "Reviewed description",
		});
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("copies system presets using reviewed input into organization-owned presets", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "System Source", isActive: true },
			null,
		];
		mockState.insertQueue = [[{ id: "custom-preset", organizationId: "org-1", name: "Reviewed Copy" }]];

		const result = await copySystemWorkPolicyPreset("org-1", "system-preset", {
			name: " Reviewed Copy ",
			description: " Reviewed custom preset ",
			scheduleEnabled: true,
			regulationEnabled: true,
			schedule: {
				scheduleCycle: "weekly",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "38",
			},
			regulation: {
				maxDailyMinutes: 480,
				maxUninterruptedMinutes: 360,
				breakRules: [],
			},
		});

		expect(result).toEqual({
			success: true,
			data: { id: "custom-preset", organizationId: "org-1", name: "Reviewed Copy" },
		});
		expect(mockState.insertValues[0]).toMatchObject({
			organizationId: "org-1",
			name: "Reviewed Copy",
			description: "Reviewed custom preset",
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "38",
			maxDailyMinutes: 480,
			maxUninterruptedMinutes: 360,
		});
		expect(mockState.insertValues[0]).not.toMatchObject({ name: "System Source" });
		expect(mockState.markOrganizationWorkBalancesDirty).not.toHaveBeenCalled();
	});

	it("preserves authorization errors through the preset import compatibility wrapper", async () => {
		mockState.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "System Source", isActive: true },
		];

		const result = await importWorkPolicyPreset("org-1", "system-preset");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertValues).toHaveLength(0);
	});

	it("rejects managers when mutating work policy definitions", async () => {
		const result = await createWorkPolicy("org-1", {
			name: "Night Shift",
			description: "Overnight coverage",
			scheduleEnabled: true,
			regulationEnabled: false,
			presenceEnabled: false,
			schedule: {
				scheduleCycle: "weekly",
				scheduleType: "simple",
				workingDaysPreset: "weekdays",
				hoursPerCycle: "40",
			},
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("lets managers assign work policies to managed members", async () => {
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];
		mockState.insertQueue = [[{ id: "assignment-1" }]];

		const result = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toEqual({ success: true, data: { id: "assignment-1" } });
	});

	it("marks organization work balances dirty after creating a work policy assignment", async () => {
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];
		mockState.insertQueue = [[{ id: "assignment-1" }]];

		const result = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("marks organization work balances dirty after deleting a work policy assignment", async () => {
		mockState.assignmentQueue = [
			{
				id: "assignment-1",
				organizationId: "org-1",
				assignmentType: "employee",
				employeeId: "employee-1",
			},
		];

		const result = await deleteWorkPolicyAssignment("assignment-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("marks organization work balances dirty after schedule-affecting work policy updates", async () => {
		mockState.isOrgAdmin = true;
		mockState.workPolicyQueue = [
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Standard",
				description: null,
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				schedule: null,
				regulation: null,
				presence: null,
			},
			{ id: "policy-1", organizationId: "org-1", name: "Standard", schedule: null },
		];

		const result = await updateWorkPolicy("policy-1", { scheduleEnabled: false });

		expect(result).toMatchObject({ success: true });
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("marks organization work balances dirty after deleting a work policy", async () => {
		mockState.isOrgAdmin = true;
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];

		const result = await deleteWorkPolicy("policy-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("marks organization work balances dirty after changing the default work policy", async () => {
		mockState.isOrgAdmin = true;
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];

		const result = await setDefaultWorkPolicy("policy-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
		});
	});

	it("rejects manager work policy assignment for unmanaged members", async () => {
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];
		mockState.targetEmployee = {
			id: "employee-2",
			organizationId: "org-1",
			role: "employee",
		};

		const result = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-2",
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("rejects work policy team assignments outside the actor organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];
		mockState.teamQueue = [null];

		const result = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "team",
			teamId: "team-outside-org",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("rejects malformed work policy assignment payloads when required target ids are missing or conflicting", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.workPolicyQueue = [
			{ id: "policy-1", organizationId: "org-1" },
			{ id: "policy-1", organizationId: "org-1" },
			{ id: "policy-1", organizationId: "org-1" },
		];

		const missingTeamId = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "team",
		});
		const missingEmployeeId = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "employee",
		});
		const conflictingIds = await createWorkPolicyAssignment("org-1", {
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
			teamId: "team-1",
		});

		expect(missingTeamId).toMatchObject({ success: false, code: "ValidationError" });
		expect(missingEmployeeId).toMatchObject({ success: false, code: "ValidationError" });
		expect(conflictingIds).toMatchObject({ success: false, code: "ValidationError" });
	});

	it("looks up effective assignments using date predicates and null effective dates as fallback", async () => {
		mockState.employeeQueue = [
			{
				id: "employee-1",
				organizationId: "org-1",
				teamId: "team-1",
				team: null,
			},
		];

		const result = await getEmployeeEffectiveScheduleDetails("employee-1");

		expect(result).toEqual({ success: true, data: null });
		expect(mockState.assignmentFindFirstArgs).toHaveLength(3);
		for (const assignmentLookup of mockState.assignmentFindFirstArgs) {
			expect(JSON.stringify(assignmentLookup.where)).toContain("effectiveFrom");
			expect(JSON.stringify(assignmentLookup.where)).toContain("effectiveUntil");
			expect(assignmentLookup.orderBy).toBeDefined();
			expect(
				assignmentLookup.orderBy(
					{ effectiveFrom: "effectiveFrom", createdAt: "createdAt" },
					{ desc: (value: unknown) => `desc:${String(value)}` },
				),
			).toEqual([{ sql: ["", " DESC NULLS LAST"], values: ["effectiveFrom"] }, "desc:createdAt"]);
		}
	});

	it("rejects effective schedule lookups for employees outside the actor organization", async () => {
		mockState.targetEmployee = {
			id: "employee-outside-org",
			organizationId: "org-2",
			role: "employee",
		};
		mockState.managedEmployeeIds = new Set(["employee-outside-org"]);
		mockState.employeeQueue = [
			{
				id: "employee-outside-org",
				organizationId: "org-2",
				teamId: "team-2",
				team: null,
			},
		];

		const result = await getEmployeeEffectiveScheduleDetails("employee-outside-org");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.assignmentFindFirstArgs).toHaveLength(0);
	});

	it("rejects managers from hidden compliance actions", async () => {
		const result = await getWorkPolicyViolations(
			"org-1",
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-31T00:00:00.000Z"),
		);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("acknowledges violations with the actor employee scoped to the active organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.actor.currentEmployee = {
			id: "actor-employee-1",
			organizationId: "org-1",
			role: "admin",
		};

		const result = await acknowledgeWorkPolicyViolation("violation-1", "Reviewed");

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateWhereArgs).toHaveLength(1);
		expect(JSON.stringify(mockState.updateWhereArgs[0])).toContain("org-1");
		expect(JSON.stringify(mockState.updateWhereArgs[0])).toContain("violation-1");
	});
});
