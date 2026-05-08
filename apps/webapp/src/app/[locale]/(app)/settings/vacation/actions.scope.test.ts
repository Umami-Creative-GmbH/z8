import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	function getEqValue(where: any, field: string) {
		if (where?.eq?.[0] === field) {
			return where.eq[1];
		}

		return where?.and?.find((condition: any) => condition?.eq?.[0] === field)?.eq?.[1];
	}

	return {
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
		absenceCategoryRows: [
			{
				id: "absence-category-1",
				organizationId: "org-1",
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
		],
		absenceCategoryFindFirst: vi.fn(async (options?: any) => {
			const id = getEqValue(options?.where, "id");
			const organizationId = getEqValue(options?.where, "organizationId");

			return (
				mockState.absenceCategoryRows.find((row) => {
					return (
						(!id || row.id === id) && (!organizationId || row.organizationId === organizationId)
					);
				}) ?? null
			);
		}),
		selectQueue: [] as Array<any>,
		teamQueue: [] as Array<any>,
		insertQueue: [] as Array<any>,
		selectWhereCalls: [] as Array<any>,
		selectFor: vi.fn(async () => {
			const where = mockState.selectWhereCalls.at(-1);
			const id = getEqValue(where, "id");
			const organizationId = getEqValue(where, "organizationId");

			return mockState.absenceCategoryRows.filter((row) => {
				return (!id || row.id === id) && (!organizationId || row.organizationId === organizationId);
			});
		}),
		deleteWhere: vi.fn(async () => undefined),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockState.db)),
		updateWhere: vi.fn(async () => undefined),
		insertValues: vi.fn(() => ({
			returning: vi.fn(async () => mockState.insertQueue.shift() ?? []),
		})),
		updateSet: vi.fn(() => ({
			where: vi.fn(() => ({ returning: vi.fn(async () => mockState.insertQueue.shift() ?? []) })),
		})),
		db: null as any,
		logAudit: vi.fn(async () => undefined),
		revalidateTag: vi.fn(),
	};
});

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
	absenceEntry: {
		id: "id",
		categoryId: "categoryId",
		organizationId: "organizationId",
	},
	timeRecordAbsence: {
		recordId: "recordId",
		absenceCategoryId: "absenceCategoryId",
		organizationId: "organizationId",
	},
	absenceCategory: {
		id: "id",
		organizationId: "organizationId",
		type: "type",
		name: "name",
		description: "description",
		requiresWorkTime: "requiresWorkTime",
		requiresApproval: "requiresApproval",
		countsAgainstVacation: "countsAgainstVacation",
		color: "color",
		isActive: "isActive",
		createdAt: "createdAt",
	},
	approvalPolicyCondition: {
		id: "id",
		organizationId: "organizationId",
		absenceCategoryId: "absenceCategoryId",
	},
	payrollExportConfig: {
		id: "id",
		organizationId: "organizationId",
	},
	payrollWageTypeMapping: {
		id: "id",
		configId: "configId",
		absenceCategoryId: "absenceCategoryId",
	},
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
		ensureSettingsActorCanAccessEmployeeTarget: vi.fn(
			(actor: typeof mockState.actor, target: any, options: any) =>
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
			absenceCategory: {
				findMany: vi.fn(async () => mockState.absenceCategoryRows),
				findFirst: mockState.absenceCategoryFindFirst,
			},
			employeeVacationAllowance: {
				findFirst: vi.fn(async () => null),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn((where: any) => {
						mockState.selectWhereCalls.push(where);

						return {
							limit: vi.fn(async () => mockState.selectQueue.shift() ?? []),
						};
					}),
				})),
				where: vi.fn((where: any) => {
					mockState.selectWhereCalls.push(where);

					return {
						for: mockState.selectFor,
						limit: vi.fn(async () => mockState.selectQueue.shift() ?? []),
					};
				}),
				orderBy: vi.fn(async () => mockState.selectQueue.shift() ?? []),
			})),
		})),
		insert: vi.fn(() => ({ values: mockState.insertValues })),
		update: vi.fn(() => ({
			set: mockState.updateSet,
		})),
		delete: vi.fn(() => ({
			where: mockState.deleteWhere,
		})),
		transaction: mockState.transaction,
	};
	mockState.db = db;

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

const { getEmployeeSettingsActorContext, requireOrgAdminEmployeeSettingsAccess } = await import(
	"../employees/employee-action-utils"
);
const {
	getVacationPolicies,
	createVacationAdjustmentAction,
	getAbsenceCategoriesForSettings,
	createAbsenceCategory,
	updateAbsenceCategory,
	setAbsenceCategoryActive,
	deleteAbsenceCategory,
} = await import("./actions");
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
		mockState.absenceCategoryRows = [
			{
				id: "absence-category-1",
				organizationId: "org-1",
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
		];
		mockState.selectQueue = [];
		mockState.selectWhereCalls = [];
		mockState.teamQueue = [];
		mockState.insertQueue = [];
		mockState.selectFor.mockClear();
		mockState.deleteWhere.mockClear();
		mockState.transaction.mockClear();
		mockState.updateWhere.mockClear();
		mockState.absenceCategoryFindFirst.mockClear();
		mockState.insertValues.mockClear();
		mockState.updateSet.mockClear();
		mockState.logAudit.mockClear();
		vi.mocked(getEmployeeSettingsActorContext).mockClear();
		vi.mocked(requireOrgAdminEmployeeSettingsAccess).mockClear();
	});

	it("lets managers read vacation policy definitions", async () => {
		const result = await getVacationPolicies("org-1");

		expect(result).toEqual({ success: true, data: mockState.policyRows });
	});

	it("lets actors read absence categories only for their organization", async () => {
		const allowed = await getAbsenceCategoriesForSettings("org-1");
		const denied = await getAbsenceCategoriesForSettings("org-2");

		expect(allowed).toEqual({ success: true, data: mockState.absenceCategoryRows });
		expect(denied).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(getEmployeeSettingsActorContext).toHaveBeenCalledWith({
			queryName: "getAbsenceCategoriesForSettings:actor",
		});
		expect(getEmployeeSettingsActorContext).not.toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: expect.any(String) }),
		);
	});

	it("rejects reading absence categories for a non-active organization", async () => {
		const result = await getAbsenceCategoriesForSettings("org-2");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(getEmployeeSettingsActorContext).toHaveBeenCalledWith({
			queryName: "getAbsenceCategoriesForSettings:actor",
		});
	});

	it("requires org admin access and non-blank names to create absence categories", async () => {
		const denied = await createAbsenceCategory({
			organizationId: "org-1",
			type: "custom",
			name: "Vacation",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
		});
		expect(denied).toMatchObject({ success: false, code: "AuthorizationError" });

		mockState.actor.accessTier = "orgAdmin";
		const blank = await createAbsenceCategory({
			organizationId: "org-1",
			type: "custom",
			name: "   ",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
		});

		expect(blank).toMatchObject({ success: false, code: "ConflictError" });
	});

	it("rejects creating absence categories for a non-active organization before admin checks", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await createAbsenceCategory({
			organizationId: "org-2",
			type: "custom",
			name: "Other org category",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(getEmployeeSettingsActorContext).toHaveBeenCalledWith({
			queryName: "createAbsenceCategory:actor",
		});
		expect(getEmployeeSettingsActorContext).not.toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: expect.any(String) }),
		);
		expect(requireOrgAdminEmployeeSettingsAccess).not.toHaveBeenCalled();
		expect(mockState.insertValues).not.toHaveBeenCalled();
	});

	it("preserves inactive state when creating absence categories", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [[{ id: "absence-category-2", isActive: false }]];

		const result = await createAbsenceCategory({
			organizationId: "org-1",
			type: "custom",
			name: "Inactive category",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			isActive: false,
		});

		expect(result).toEqual({ success: true, data: { id: "absence-category-2", isActive: false } });
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Inactive category",
				isActive: false,
			}),
		);
	});

	it("returns not found when updating, toggling, or deleting absence categories outside the actor organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.absenceCategoryRows = [
			{ id: "absence-category-2", organizationId: "org-2", name: "Other", isActive: true },
		];

		const updated = await updateAbsenceCategory("absence-category-2", {
			type: "custom",
			name: "Personal",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			isActive: true,
		});
		const toggled = await setAbsenceCategoryActive("absence-category-2", false);
		const deleted = await deleteAbsenceCategory("absence-category-2");

		expect(updated).toMatchObject({ success: false, code: "NotFoundError" });
		expect(toggled).toMatchObject({ success: false, code: "NotFoundError" });
		expect(deleted).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("rejects operational rule updates for absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "custom",
			name: "Vacation",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"This category is used by existing absences. Create a new category for different rules, or deactivate this one.",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("rejects operational rule updates for absence categories used by canonical absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[], [{ recordId: "record-1" }]];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Vacation",
			requiresWorkTime: true,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"This category is used by existing absences. Create a new category for different rules, or deactivate this one.",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("rejects requires approval updates for absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Vacation",
			requiresWorkTime: false,
			requiresApproval: false,
			countsAgainstVacation: true,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"This category is used by existing absences. Create a new category for different rules, or deactivate this one.",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("rejects vacation counter updates for absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Vacation",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"This category is used by existing absences. Create a new category for different rules, or deactivate this one.",
		});
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("allows cosmetic and active status updates for absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];
		mockState.insertQueue = [
			[
				{
					id: "absence-category-1",
					name: "Paid vacation",
					color: "#0f766e",
					isActive: false,
				},
			],
		];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Paid vacation",
			description: "Updated description",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#0f766e",
			isActive: false,
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "absence-category-1", name: "Paid vacation", isActive: false },
		});
		expect(mockState.selectWhereCalls).toHaveLength(2);
		expect(mockState.selectFor).toHaveBeenCalledWith("update");
		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Paid vacation",
				color: "#0f766e",
				isActive: false,
			}),
		);
	});

	it("updates absence categories inside a transaction after locking the target row", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [
			[
				{
					id: "absence-category-1",
					organizationId: "org-1",
					name: "Vacation renamed",
					isActive: true,
				},
			],
		];

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Vacation renamed",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "absence-category-1", name: "Vacation renamed", isActive: true },
		});
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.selectFor).toHaveBeenCalledWith("update");
		expect(mockState.updateSet).toHaveBeenCalledTimes(1);
	});

	it("returns not found when the locked absence category update returns no row", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await updateAbsenceCategory("absence-category-1", {
			type: "vacation",
			name: "Vacation renamed",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#2563eb",
			isActive: true,
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.selectFor).toHaveBeenCalledWith("update");
		expect(mockState.updateSet).toHaveBeenCalledTimes(1);
	});

	it("updates only absence category active status without stale field writes", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [
			[
				{
					id: "absence-category-1",
					organizationId: "org-1",
					name: "Vacation renamed elsewhere",
					isActive: false,
				},
			],
		];

		const result = await setAbsenceCategoryActive("absence-category-1", false);

		expect(result).toMatchObject({
			success: true,
			data: { id: "absence-category-1", name: "Vacation renamed elsewhere", isActive: false },
		});
		expect(mockState.updateSet).toHaveBeenCalledWith({ isActive: false });
	});

	it("requires org admin access before looking up absence category status updates", async () => {
		const result = await setAbsenceCategoryActive("absence-category-1", false);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.absenceCategoryFindFirst).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("returns not found when absence category active status update returns no row", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await setAbsenceCategoryActive("absence-category-1", false);

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.absenceCategoryFindFirst).toHaveBeenCalledTimes(1);
		expect(mockState.updateSet).toHaveBeenCalledWith({ isActive: false });
	});

	it("rejects deleting absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error: "Deactivate this category instead because it is used by existing absences.",
		});
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("checks legacy absence category references without requiring organization id", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toEqual({ success: true, data: { id: "absence-category-1" } });
		expect(JSON.stringify(mockState.selectWhereCalls[1])).not.toContain("organizationId");
	});

	it("deletes absence categories inside a transaction after locking the target row", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toEqual({ success: true, data: { id: "absence-category-1" } });
		expect(mockState.transaction).toHaveBeenCalledTimes(1);
		expect(mockState.selectFor).toHaveBeenCalledWith("update");
		expect(mockState.deleteWhere).toHaveBeenCalledTimes(1);
	});

	it("rejects deleting absence categories used by canonical absence records", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[], [{ recordId: "record-1" }]];

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error: "Deactivate this category instead because it is used by existing absences.",
		});
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("rejects deleting absence categories used by approval policy conditions", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[], [], [{ id: "condition-1" }]];

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error: "Deactivate this category or remove dependent approval policies before deleting it.",
		});
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});

	it("rejects deleting absence categories used by payroll wage type mappings", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[], [], [], [{ id: "mapping-1" }]];

		const result = await deleteAbsenceCategory("absence-category-1");

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"Deactivate this category or remove dependent payroll wage type mappings before deleting it.",
		});
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
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
		mockState.selectQueue = [
			[{ id: "policy-1", organizationId: "org-1" }],
			[{ id: "policy-1", organizationId: "org-1" }],
			[{ id: "policy-1", organizationId: "org-1" }],
		];

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
		mockState.insertQueue = [
			[{ id: "adjustment-1", employeeId: "employee-1", year: 2026, days: "2" }],
		];

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
