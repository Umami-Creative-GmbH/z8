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
	targetEmployee: {
		id: "employee-1",
		organizationId: "org-1",
		role: "employee" as const,
	},
	managedEmployeeIds: new Set<string>(["employee-1"]),
	policyRows: [{ id: "policy-1", organizationId: "org-1", name: "Standard" }],
	selectQueue: [] as Array<any>,
	teamQueue: [] as Array<any>,
	insertQueue: [] as Array<any>,
	updateWhere: vi.fn(async () => undefined),
	logAudit: vi.fn(async () => undefined),
	revalidateTag: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	desc: vi.fn((value: unknown) => value),
}));

vi.mock("next/cache", () => ({
	revalidateTag: mockState.revalidateTag,
}));

vi.mock("@/db/schema", () => ({
	employee: { id: "id", organizationId: "organizationId", role: "role" },
	employeeVacationAllowance: { id: "id", employeeId: "employeeId", year: "year" },
	vacationAdjustment: { id: "id", employeeId: "employeeId", year: "year" },
	vacationAllowance: {
		id: "id",
		organizationId: "organizationId",
		isActive: "isActive",
		isCompanyDefault: "isCompanyDefault",
		startDate: "startDate",
		name: "name",
	},
	vacationPolicyAssignment: {
		id: "id",
		employeeId: "employeeId",
		assignmentType: "assignmentType",
		isActive: "isActive",
	},
}));

vi.mock("@/lib/cache/tags", () => ({
	CACHE_TAGS: {
		VACATION_POLICY: (organizationId: string) => `vacation:${organizationId}`,
	},
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {
		VACATION_ALLOWANCE_UPDATED: "VACATION_ALLOWANCE_UPDATED",
	},
	logAudit: mockState.logAudit,
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
							message: "Employee profile not found for vacation adjustment",
							entityType: "employee",
							entityId: actor.session.user.id,
						}),
					),
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
			team: {
				findFirst: vi.fn(async () => mockState.teamQueue.shift() ?? null),
			},
			vacationAllowance: {
				findMany: vi.fn(async () => mockState.policyRows),
				findFirst: vi.fn(async () => mockState.policyRows[0] ?? null),
			},
			employeeVacationAllowance: {
				findFirst: vi.fn(async () => null),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(async () => mockState.selectQueue.shift() ?? []),
				})),
				orderBy: vi.fn(async () => mockState.selectQueue.shift() ?? []),
			})),
		})),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(async () => mockState.insertQueue.shift() ?? []),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: mockState.updateWhere,
			})),
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

					return { success: false as const, error: "Unknown error", code: "UNKNOWN_ERROR" };
				},
			});
		},
	};
});

const { getVacationPolicies, createVacationAdjustmentAction } = await import("./actions");
const { createVacationPolicyAssignment } = await import("./assignment-actions");

describe("vacation settings scope actions", () => {
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
		mockState.policyRows = [{ id: "policy-1", organizationId: "org-1", name: "Standard" }];
		mockState.selectQueue = [];
		mockState.teamQueue = [];
		mockState.insertQueue = [];
		mockState.updateWhere.mockClear();
		mockState.logAudit.mockClear();
	});

	it("lets managers read vacation policy definitions", async () => {
		const result = await getVacationPolicies("org-1");

		expect(result).toEqual({ success: true, data: mockState.policyRows });
	});

	it("lets managers assign a vacation policy only to managed members", async () => {
		mockState.selectQueue = [[{ id: "policy-1", organizationId: "org-1" }]];
		mockState.insertQueue = [[{ id: "assignment-1" }]];

		const result = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toEqual({ success: true, data: { id: "assignment-1" } });
	});

	it("rejects manager vacation policy assignment for unmanaged members", async () => {
		mockState.targetEmployee = {
			id: "employee-2",
			organizationId: "org-1",
			role: "employee",
		};
		mockState.selectQueue = [[{ id: "policy-1", organizationId: "org-1" }]];

		const result = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-2",
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("rejects vacation team assignments outside the actor organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "policy-1", organizationId: "org-1" }]];
		mockState.teamQueue = [null];

		const result = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "team",
			teamId: "team-outside-org",
		});

		expect(result).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("rejects malformed vacation assignment payloads when required target ids are missing or conflicting", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "policy-1", organizationId: "org-1" }], [{ id: "policy-1", organizationId: "org-1" }], [{ id: "policy-1", organizationId: "org-1" }]];

		const missingTeamId = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "team",
		});
		const missingEmployeeId = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
		});
		const conflictingIds = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "team",
			teamId: "team-1",
			employeeId: "employee-1",
		});

		expect(missingTeamId).toMatchObject({ success: false, code: "ValidationError" });
		expect(missingEmployeeId).toMatchObject({ success: false, code: "ValidationError" });
		expect(conflictingIds).toMatchObject({ success: false, code: "ValidationError" });
	});

	it("lets managers create vacation adjustments for managed members", async () => {
		mockState.insertQueue = [[{ id: "adjustment-1", employeeId: "employee-1", year: 2026, days: "2" }]];

		const result = await createVacationAdjustmentAction("employee-1", 2026, {
			days: "2",
			reason: "Carryover correction",
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "adjustment-1", employeeId: "employee-1", year: 2026, days: "2" },
		});
		expect(mockState.insertQueue).toEqual([]);
		expect(mockState.logAudit).toHaveBeenCalledTimes(1);
	});

	it("rejects vacation adjustments when the actor has no employee record for adjustedBy", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.actor.currentEmployee = null;

		const result = await createVacationAdjustmentAction("employee-1", 2026, {
			days: "3",
			reason: "Owner correction",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});

	it("rejects manager vacation adjustments for unmanaged members", async () => {
		mockState.targetEmployee = {
			id: "employee-3",
			organizationId: "org-1",
			role: "employee",
		};

		const result = await createVacationAdjustmentAction("employee-3", 2026, {
			days: "1",
			reason: "Manual correction",
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});
});
