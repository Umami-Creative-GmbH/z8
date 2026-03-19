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
	workPolicies: [{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true }],
	workPolicyQueue: [] as Array<any>,
	teamQueue: [] as Array<any>,
	violationRows: [{ id: "violation-1", organizationId: "org-1" }],
	insertQueue: [] as Array<any>,
	selectQueue: [] as Array<any>,
	selectWhereArgs: [] as Array<any>,
	updateWhereArgs: [] as Array<any>,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	desc: vi.fn((value: unknown) => value),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	isNull: vi.fn((value: unknown) => ({ isNull: value })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
	or: vi.fn((...args: unknown[]) => ({ or: args })),
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", userId: "userId", isActive: "isActive", organizationId: "organizationId" },
	team: { id: "id", organizationId: "organizationId", name: "name" },
	workPolicy: { id: "id", organizationId: "organizationId", isActive: "isActive", name: "name" },
	workPolicyAssignment: { id: "id", organizationId: "organizationId", employeeId: "employeeId", assignmentType: "assignmentType", isActive: "isActive", effectiveFrom: "effectiveFrom", effectiveUntil: "effectiveUntil", createdAt: "createdAt", teamId: "teamId" },
	workPolicyBreakOption: { sortOrder: "sortOrder" },
	workPolicyBreakRule: { sortOrder: "sortOrder" },
	workPolicyPresence: {},
	workPolicyPreset: { id: "id", isActive: "isActive", name: "name" },
	workPolicyRegulation: {},
	workPolicySchedule: {},
	workPolicyScheduleDay: {},
	workPolicyViolation: { id: "id", organizationId: "organizationId", violationDate: "violationDate" },
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: vi.fn(async () => false),
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	currentTimestamp: () => new Date("2026-01-01T00:00:00.000Z"),
}));

vi.mock("../employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError, NotFoundError, ValidationError } = await import("@/lib/effect/errors");

	return {
		getEmployeeSettingsActorContext: vi.fn(() => Effect.succeed(mockState.actor)),
		getManagedEmployeeIdsForSettingsActor: vi.fn(() => Effect.succeed(mockState.managedEmployeeIds)),
		validateAssignmentTargetFields: vi.fn((assignmentType: string, input: { teamId?: string; employeeId?: string }) => {
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
						new ValidationError({ message: "Team assignments require a teamId", field: "teamId" }),
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
		}),
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
			managedIds ? items.filter((item) => managedIds.has(item.employeeId ?? item.employee?.id)) : items,
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
		ensureSettingsActorCanAccessEmployeeTarget: vi.fn((actor: typeof mockState.actor, target: any, options: any) =>
			actor.accessTier === "orgAdmin" || mockState.managedEmployeeIds.has(target.id)
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
		requireSettingsActorEmployeeAssignmentAccess: vi.fn((actor: typeof mockState.actor, assignmentType: string, options: any) =>
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
				findFirst: vi.fn(async () => null),
				findMany: vi.fn(async () => []),
			},
			team: {
				findMany: vi.fn(async () => []),
				findFirst: vi.fn(async () => mockState.teamQueue.shift() ?? null),
			},
			workPolicyAssignment: {
				findMany: vi.fn(async () => []),
				findFirst: vi.fn(async () => null),
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
			values: vi.fn(() => ({
				returning: vi.fn(async () => mockState.insertQueue.shift() ?? []),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async (input: unknown) => {
					mockState.updateWhereArgs.push(input);
					return undefined;
				}),
			})),
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
	getWorkPolicies,
	getWorkPolicyViolations,
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
		mockState.targetEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		};
		mockState.workPolicies = [{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true }];
		mockState.workPolicyQueue = [];
		mockState.teamQueue = [];
		mockState.insertQueue = [];
		mockState.selectQueue = [];
		mockState.selectWhereArgs = [];
		mockState.updateWhereArgs = [];
	});

	it("lets managers read work policy definitions", async () => {
		const result = await getWorkPolicies("org-1");

		expect(result).toEqual({ success: true, data: mockState.workPolicies });
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
