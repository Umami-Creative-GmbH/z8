import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const dialect = new PgDialect();
function rendered(where: SQL) {
	return dialect.sqlToQuery(where);
}

const mockState = vi.hoisted(() => {
	// A row matches a lookup when the lookup names its organization and, if it
	// names a row of this kind at all, this row's ID.
	function matches(row: Record<string, unknown>, where: unknown, idPrefix: string) {
		const params = (
			globalThis as unknown as { __vacationParamsOf: (where: unknown) => unknown[] }
		).__vacationParamsOf(where);
		const namesKind = params.some(
			(param) => typeof param === "string" && param.startsWith(idPrefix),
		);
		return params.includes(row.organizationId) && (!namesKind || params.includes(row.id));
	}

	return {
		actor: {
			accessTier: "manager" as "manager" | "orgAdmin",
			currentEmployee: {
				id: "manager-employee-1",
				role: "manager",
			} as { id: string; role: "admin" | "manager" | "employee" } | null,
		},
		targetEmployee: {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee" as const,
		},
		managedEmployeeIds: new Set<string>(["employee-1"]),
		policyRows: [{ id: "policy-1", organizationId: "org-1", name: "Standard" }] as Array<
			Record<string, unknown>
		>,
		policyFindFirst: vi.fn(
			async (options?: { where?: unknown }) =>
				mockState.policyRows.find((row) => matches(row, options?.where, "policy-")) ?? null,
		),
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
		] as Array<Record<string, unknown>>,
		absenceCategoryFindFirst: vi.fn(async () => null),
		employeeFindFirst: vi.fn(async (options?: { where?: unknown }) =>
			matches(mockState.targetEmployee, options?.where, "employee-")
				? mockState.targetEmployee
				: null,
		),
		assignmentRow: null as Record<string, unknown> | null,
		selectQueue: [] as Array<unknown>,
		insertQueue: [] as Array<unknown>,
		selectWhereCalls: [] as Array<unknown>,
		selectFor: vi.fn(async () => {
			const where = mockState.selectWhereCalls.at(-1);
			return mockState.absenceCategoryRows.filter((row) =>
				matches(row, where, "absence-category-"),
			);
		}),
		deleteWhere: vi.fn(async () => undefined),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockState.db)),
		updateWhere: vi.fn(async (_where: unknown) => undefined),
		insertValues: vi.fn((_values: unknown) => ({
			returning: vi.fn(async () => mockState.insertQueue.shift() ?? []),
		})),
		updateSet: vi.fn((_values: unknown) => ({
			where: vi.fn((where: unknown) => {
				mockState.updateWhere(where);
				return { returning: vi.fn(async () => mockState.insertQueue.shift() ?? []) };
			}),
		})),
		db: null as unknown,
		logAudit: vi.fn(async () => undefined),
		revalidateTag: vi.fn(),
		formerEmployeeIds: new Set<string>(),
	};
});

(
	globalThis as unknown as { __vacationParamsOf: (where: unknown) => unknown[] }
).__vacationParamsOf = (where) => (where ? rendered(where as SQL).params : []);

function callerOf(): StubCaller {
	const { accessTier, currentEmployee } = mockState.actor;
	return {
		userId: "user-1",
		activeOrganizationId: "org-1",
		membershipRole: accessTier === "orgAdmin" ? "admin" : "member",
		employee: currentEmployee ? { ...currentEmployee, former: false } : null,
	};
}

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => mockState.formerEmployeeIds),
);

vi.mock("next/cache", () => ({
	revalidateTag: mockState.revalidateTag,
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

vi.mock("@/lib/effect/runtime", async () => {
	const db = {
		query: {
			vacationAllowance: {
				findMany: vi.fn(async () => mockState.policyRows),
				findFirst: mockState.policyFindFirst,
			},
			absenceCategory: {
				findMany: vi.fn(async () => mockState.absenceCategoryRows),
				findFirst: mockState.absenceCategoryFindFirst,
			},
			employee: { findFirst: mockState.employeeFindFirst },
			vacationPolicyRollout: { findFirst: vi.fn(async () => ({ baselineDate: "2026-01-01" })) },
			vacationPolicyAssignment: { findFirst: vi.fn(async () => mockState.assignmentRow) },
			employeeVacationAllowance: {
				findFirst: vi.fn(async () => null),
			},
		},
		select: vi.fn((selection?: Record<string, unknown>) => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn((where: unknown) => {
						mockState.selectWhereCalls.push(where);

						return {
							limit: vi.fn(async () => mockState.selectQueue.shift() ?? []),
						};
					}),
				})),
				where: vi.fn((where: unknown) => {
					mockState.selectWhereCalls.push(where);

					return {
						for: mockState.selectFor,
						// biome-ignore lint/suspicious/noThenProperty: Drizzle select builders are intentionally awaitable and also expose limit/for.
						then: (resolve: (value: unknown) => unknown) =>
							Promise.resolve(mockState.selectQueue.shift() ?? []).then(resolve),
						limit: vi.fn(async () =>
							selection && "timezone" in selection
								? [{ timezone: "UTC" }]
								: (mockState.selectQueue.shift() ?? []),
						),
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
		execute: async () => [],
		transaction: mockState.transaction,
	};
	mockState.db = db;

	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(callerOf, {
			db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...mockState.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const {
	getVacationPolicies,
	createVacationPolicy,
	updateVacationPolicy,
	createVacationAdjustmentAction,
	getAbsenceCategoriesForSettings,
	createAbsenceCategory,
	updateAbsenceCategory,
	setAbsenceCategoryActive,
	deleteAbsenceCategory,
	deleteVacationPolicy,
	getEmployeeVacationBalance,
	getEmployeeAllowance,
	updateEmployeeAllowance,
	getEmployeeAdjustmentSummary,
	getEmployeesWithAllowances,
	getVacationPolicy,
	getCompanyDefaultVacationPolicy,
} = await import("./actions");
const {
	createVacationPolicyAssignment,
	deleteVacationPolicyAssignment,
	getVacationPolicyAssignments,
	getEmployeePolicyAssignment,
	setEmployeePolicyAssignment,
	getCompanyDefaultPolicies,
	previewEmployeeVacationPolicy,
	getVacationPolicyHistoryContext,
	getVacationPolicies: getAssignmentPolicies,
} = await import("./assignment-actions");

describe("vacation settings scope actions", () => {
	beforeEach(() => {
		mockState.actor.accessTier = "manager";
		mockState.actor.currentEmployee = {
			id: "manager-employee-1",
			role: "manager",
		};
		mockState.managedEmployeeIds = new Set(["employee-1"]);
		mockState.formerEmployeeIds = new Set();
		mockState.targetEmployee = {
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		};
		mockState.policyRows = [
			{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true },
		];
		mockState.assignmentRow = null;
		mockState.absenceCategoryRows = [
			{
				id: "absence-category-1",
				organizationId: "org-1",
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				drawsOnWorkBalance: false,
				color: "#2563eb",
				isActive: true,
			},
		];
		mockState.selectQueue = [];
		mockState.selectWhereCalls = [];

		mockState.insertQueue = [];
		mockState.policyFindFirst.mockClear();
		mockState.selectFor.mockClear();
		mockState.deleteWhere.mockClear();
		mockState.transaction.mockClear();
		mockState.updateWhere.mockClear();
		mockState.absenceCategoryFindFirst.mockClear();
		mockState.insertValues.mockClear();
		mockState.updateSet.mockClear();
		mockState.logAudit.mockClear();
	});

	it("lets managers read vacation policy definitions", async () => {
		const result = await getVacationPolicies();

		expect(result).toEqual({ success: true, data: mockState.policyRows });
	});

	describe("vacation policy proration settings (#1109)", () => {
		const policyInput = {
			name: "Standard",
			startDate: "2027-01-01",
			defaultAnnualDays: "30",
			accrualType: "annual" as const,
			allowCarryover: false,
		};
		const storedPolicy = {
			id: "policy-1",
			organizationId: "org-1",
			name: "Standard",
			isCompanyDefault: false,
			defaultAnnualDays: "30",
			prorateInStartAndExitYear: true,
			statutoryMinimumDays: "20",
		};

		beforeEach(() => {
			mockState.actor.accessTier = "orgAdmin";
			mockState.policyRows = [storedPolicy];
		});

		it("gives a new policy the proration switch and a statutory minimum of min(20, annual days)", async () => {
			mockState.insertQueue = [[{ id: "policy-2" }], [{ id: "policy-3" }]];

			await createVacationPolicy(policyInput);
			await createVacationPolicy({ ...policyInput, name: "Part-time", defaultAnnualDays: "15" });

			expect(mockState.insertValues).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ prorateInStartAndExitYear: true, statutoryMinimumDays: "20" }),
			);
			expect(mockState.insertValues).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ prorateInStartAndExitYear: true, statutoryMinimumDays: "15" }),
			);
		});

		it("creates a policy with the settings an admin chose", async () => {
			mockState.insertQueue = [[{ id: "policy-2" }]];

			const result = await createVacationPolicy({
				...policyInput,
				prorateInStartAndExitYear: false,
				statutoryMinimumDays: "24",
			});

			expect(result).toMatchObject({ success: true });
			expect(mockState.insertValues).toHaveBeenCalledWith(
				expect.objectContaining({ prorateInStartAndExitYear: false, statutoryMinimumDays: "24" }),
			);
		});

		it.each(["-1", "31"])(
			"refuses to create a policy with a statutory minimum of %s on 30 annual days",
			async (statutoryMinimumDays) => {
				const result = await createVacationPolicy({ ...policyInput, statutoryMinimumDays });

				expect(result).toMatchObject({ success: false, code: "ValidationError" });
				expect(mockState.insertValues).not.toHaveBeenCalled();
			},
		);

		it("updates both settings", async () => {
			mockState.insertQueue = [[{ id: "policy-1" }]];

			const result = await updateVacationPolicy({
				policyId: "policy-1",
				data: {
					...policyInput,
					prorateInStartAndExitYear: false,
					statutoryMinimumDays: "25",
				},
			});

			expect(result).toMatchObject({ success: true });
			expect(mockState.updateSet).toHaveBeenCalledWith(
				expect.objectContaining({ prorateInStartAndExitYear: false, statutoryMinimumDays: "25" }),
			);
		});

		it.each([
			{ statutoryMinimumDays: "-0.5", defaultAnnualDays: "30" },
			{ statutoryMinimumDays: "30.5", defaultAnnualDays: "30" },
			// Lowering the annual days below the stored statutory minimum of 20.
			{ statutoryMinimumDays: undefined, defaultAnnualDays: "18" },
		])("refuses to update a policy to %o", async (input) => {
			const result = await updateVacationPolicy({
				policyId: "policy-1",
				data: { ...policyInput, ...input },
			});

			expect(result).toMatchObject({ success: false, code: "ValidationError" });
			expect(mockState.updateSet).not.toHaveBeenCalled();
		});

		it("does not let an admin update another organization's policy", async () => {
			mockState.policyRows = [{ ...storedPolicy, organizationId: "org-2" }];

			const result = await updateVacationPolicy({
				policyId: "policy-1",
				data: {
					...policyInput,
					statutoryMinimumDays: "10",
				},
			});

			expect(result).toMatchObject({ success: false, code: "NotFoundError" });
			expect(mockState.updateSet).not.toHaveBeenCalled();
		});

		it("keeps policy writes for org admins", async () => {
			mockState.actor.accessTier = "manager";

			const created = await createVacationPolicy(policyInput);
			const updated = await updateVacationPolicy({ policyId: "policy-1", data: policyInput });

			expect(created).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(updated).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(mockState.insertValues).not.toHaveBeenCalled();
			expect(mockState.updateSet).not.toHaveBeenCalled();
		});
	});

	it("lets scoped managers read the active organization's absence categories", async () => {
		const result = await getAbsenceCategoriesForSettings();

		expect(result).toEqual({ success: true, data: mockState.absenceCategoryRows });
	});

	it("requires org admin access and non-blank names to create absence categories", async () => {
		const denied = await createAbsenceCategory({
			type: "custom",
			name: "Vacation",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
		});
		expect(denied).toMatchObject({ success: false, code: "AuthorizationError" });

		mockState.actor.accessTier = "orgAdmin";
		const blank = await createAbsenceCategory({
			type: "custom",
			name: "   ",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
		});

		expect(blank).toMatchObject({ success: false, code: "ConflictError" });
	});

	it("creates absence categories in the active organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [[{ id: "absence-category-2" }]];

		const result = await createAbsenceCategory({
			type: "custom",
			name: "Other category",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
		});

		expect(result).toMatchObject({ success: true });
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", name: "Other category" }),
		);
	});

	it("preserves inactive state when creating absence categories", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [[{ id: "absence-category-2", isActive: false }]];

		const result = await createAbsenceCategory({
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

	it.each([
		{ countsAgainstVacation: true, requiresWorkTime: false },
		{ countsAgainstVacation: false, requiresWorkTime: true },
	])("refuses a category that draws on the work balance with %o", async (combined) => {
		mockState.actor.accessTier = "orgAdmin";

		const created = await createAbsenceCategory({
			type: "custom",
			name: "Overtime off",
			requiresApproval: true,
			drawsOnWorkBalance: true,
			...combined,
		});
		const updated = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "custom",
				name: "Overtime off",
				requiresApproval: true,
				drawsOnWorkBalance: true,
				isActive: true,
				...combined,
			},
		});

		for (const result of [created, updated]) {
			expect(result).toMatchObject({
				success: false,
				code: "ConflictError",
				error:
					'"Draws on work balance" cannot be combined with "Counts against vacation" or "Requires work time".',
			});
		}
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("creates a category that draws on the work balance", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.insertQueue = [[{ id: "absence-category-2" }]];

		const result = await createAbsenceCategory({
			type: "custom",
			name: "Overtime off",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			drawsOnWorkBalance: true,
		});

		expect(result).toMatchObject({ success: true });
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ drawsOnWorkBalance: true, countsAgainstVacation: false }),
		);
	});

	it("rejects a work balance rule update for a category used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.absenceCategoryRows = [
			{
				...mockState.absenceCategoryRows[0],
				countsAgainstVacation: false,
			},
		];
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: false,
				drawsOnWorkBalance: true,
				color: "#2563eb",
				isActive: true,
			},
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("returns not found when updating, toggling, or deleting absence categories outside the actor organization", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.absenceCategoryRows = [
			{ id: "absence-category-2", organizationId: "org-2", name: "Other", isActive: true },
		];

		const updated = await updateAbsenceCategory({
			categoryId: "absence-category-2",
			data: {
				type: "custom",
				name: "Personal",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: false,
				isActive: true,
			},
		});
		const toggled = await setAbsenceCategoryActive({
			categoryId: "absence-category-2",
			isActive: false,
		});
		const deleted = await deleteAbsenceCategory("absence-category-2");

		expect(updated).toMatchObject({ success: false, code: "NotFoundError" });
		expect(toggled).toMatchObject({ success: false, code: "NotFoundError" });
		expect(deleted).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("rejects operational rule updates for absence categories used by existing absences", async () => {
		mockState.actor.accessTier = "orgAdmin";
		mockState.selectQueue = [[{ id: "absence-1" }]];

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "custom",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: true,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: false,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: false,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Paid vacation",
				description: "Updated description",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#0f766e",
				isActive: false,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation renamed",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await updateAbsenceCategory({
			categoryId: "absence-category-1",
			data: {
				type: "vacation",
				name: "Vacation renamed",
				requiresWorkTime: false,
				requiresApproval: true,
				countsAgainstVacation: true,
				color: "#2563eb",
				isActive: true,
			},
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

		const result = await setAbsenceCategoryActive({
			categoryId: "absence-category-1",
			isActive: false,
		});

		expect(result).toMatchObject({
			success: true,
			data: { id: "absence-category-1", name: "Vacation renamed elsewhere", isActive: false },
		});
		expect(mockState.updateSet).toHaveBeenCalledWith({ isActive: false });
	});

	it("requires org admin access before looking up absence category status updates", async () => {
		const result = await setAbsenceCategoryActive({
			categoryId: "absence-category-1",
			isActive: false,
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.absenceCategoryFindFirst).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	it("returns not found when absence category active status update returns no row", async () => {
		mockState.actor.accessTier = "orgAdmin";

		const result = await setAbsenceCategoryActive({
			categoryId: "absence-category-1",
			isActive: false,
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
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
		expect(rendered(mockState.selectWhereCalls[1] as SQL).sql).not.toContain("organization_id");
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

	it("refuses assigning a vacation policy to a former employee (#1438)", async () => {
		mockState.formerEmployeeIds = new Set(["employee-1"]);
		mockState.selectQueue = [[{ id: "policy-1", organizationId: "org-1" }]];
		mockState.insertQueue = [[{ id: "assignment-1" }]];

		const result = await createVacationPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
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
		mockState.selectQueue.push([]);

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

		const result = await createVacationAdjustmentAction({
			employeeId: "employee-1",
			year: 2026,
			data: {
				days: "2",
				reason: "Carryover correction",
			},
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

		const result = await createVacationAdjustmentAction({
			employeeId: "employee-1",
			year: 2026,
			data: {
				days: "3",
				reason: "Owner correction",
			},
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

		const result = await createVacationAdjustmentAction({
			employeeId: "employee-3",
			year: 2026,
			data: {
				days: "1",
				reason: "Manual correction",
			},
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.logAudit).not.toHaveBeenCalled();
	});

	describe("vacation policy deletion scope (#1114)", () => {
		beforeEach(() => {
			mockState.actor.accessTier = "orgAdmin";
			mockState.revalidateTag.mockClear();
		});

		it("deletes a policy only within the actor's organization", async () => {
			const result = await deleteVacationPolicy("policy-1");

			expect(result).toMatchObject({ success: true });
			expect(mockState.updateSet).toHaveBeenCalledWith({ isActive: false });
			expect(
				mockState.updateWhere.mock.calls.map(([where]) => rendered(where as SQL).params),
			).toContainEqual(["policy-1", "org-1"]);
		});

		it("does not let an admin delete another organization's policy", async () => {
			mockState.policyRows = [{ id: "policy-1", organizationId: "org-2", name: "Standard" }];

			const result = await deleteVacationPolicy("policy-1");

			expect(result).toMatchObject({ success: false, code: "NotFoundError" });
			expect(mockState.updateSet).not.toHaveBeenCalled();
			expect(mockState.revalidateTag).not.toHaveBeenCalledWith("vacation:org-2", "max");
		});

		it("soft-deletes a policy assignment only within the actor's organization", async () => {
			mockState.assignmentRow = {
				id: "assignment-1",
				organizationId: "org-1",
				effectiveStartDate: "2026-01-01",
				effectiveEndDate: null,
			};
			mockState.selectQueue = [
				[
					{
						id: "assignment-1",
						organizationId: "org-1",
						assignmentType: "organization",
						employeeId: null,
					},
				],
			];

			const result = await deleteVacationPolicyAssignment({ assignmentId: "assignment-1" });

			expect(result).toMatchObject({ success: true });
			expect(
				mockState.updateWhere.mock.calls.map(([where]) => rendered(where as SQL).params),
			).toContainEqual(["assignment-1", "org-1"]);
		});
	});
});

describe("vacation settings access", () => {
	beforeEach(() => {
		mockState.insertValues.mockClear();
		mockState.updateSet.mockClear();
		mockState.deleteWhere.mockClear();
	});

	it.each([
		["getVacationPolicy", () => getVacationPolicy("policy-1")],
		["getCompanyDefaultVacationPolicy", () => getCompanyDefaultVacationPolicy()],
		["getEmployeesWithAllowances", () => getEmployeesWithAllowances(2026)],
		["getEmployeeAllowance", () => getEmployeeAllowance({ employeeId: "employee-1", year: 2026 })],
		[
			"updateEmployeeAllowance",
			() => updateEmployeeAllowance({ employeeId: "employee-1", year: 2026, data: {} }),
		],
		[
			"createVacationAdjustmentAction",
			() =>
				createVacationAdjustmentAction({
					employeeId: "employee-1",
					year: 2026,
					data: { days: "1", reason: "Correction" },
				}),
		],
		["getVacationPolicies", () => getVacationPolicies()],
		["getAbsenceCategoriesForSettings", () => getAbsenceCategoriesForSettings()],
		[
			"getEmployeeAdjustmentSummary",
			() => getEmployeeAdjustmentSummary({ employeeId: "employee-1", year: 2026 }),
		],
		["getEmployeeVacationBalance", () => getEmployeeVacationBalance("employee-1")],
		["assignment getVacationPolicies", () => getAssignmentPolicies()],
		["getVacationPolicyAssignments", () => getVacationPolicyAssignments()],
		[
			"createVacationPolicyAssignment",
			() =>
				createVacationPolicyAssignment({
					policyId: "policy-1",
					assignmentType: "employee",
					employeeId: "employee-1",
				}),
		],
		["getEmployeePolicyAssignment", () => getEmployeePolicyAssignment("employee-1")],
		[
			"setEmployeePolicyAssignment",
			() => setEmployeePolicyAssignment({ employeeId: "employee-1", policyId: null }),
		],
		[
			"deleteVacationPolicyAssignment",
			() => deleteVacationPolicyAssignment({ assignmentId: "a-1" }),
		],
		["getCompanyDefaultPolicies", () => getCompanyDefaultPolicies()],
		[
			"previewEmployeeVacationPolicy",
			() => previewEmployeeVacationPolicy({ employeeId: "employee-1", date: "2026-06-01" }),
		],
		["getVacationPolicyHistoryContext", () => getVacationPolicyHistoryContext()],
	])("refuses %s to an org member", async (_name, call) => {
		mockState.actor.accessTier = "manager";
		mockState.actor.currentEmployee = { id: "member-employee-1", role: "employee" };

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
	});

	const policy = {
		name: "Standard",
		startDate: "2027-01-01",
		defaultAnnualDays: "30",
		accrualType: "annual" as const,
		allowCarryover: false,
	};
	const category = {
		type: "custom" as const,
		name: "Other",
		requiresWorkTime: false,
		requiresApproval: true,
		countsAgainstVacation: false,
	};

	it.each([
		["createVacationPolicy", () => createVacationPolicy(policy)],
		["updateVacationPolicy", () => updateVacationPolicy({ policyId: "policy-1", data: policy })],
		["deleteVacationPolicy", () => deleteVacationPolicy("policy-1")],
		["createAbsenceCategory", () => createAbsenceCategory(category)],
		[
			"updateAbsenceCategory",
			() =>
				updateAbsenceCategory({
					categoryId: "absence-category-1",
					data: { ...category, isActive: true },
				}),
		],
		[
			"setAbsenceCategoryActive",
			() => setAbsenceCategoryActive({ categoryId: "absence-category-1", isActive: false }),
		],
		["deleteAbsenceCategory", () => deleteAbsenceCategory("absence-category-1")],
		[
			"createVacationPolicyAssignment for the organization",
			() =>
				createVacationPolicyAssignment({ policyId: "policy-1", assignmentType: "organization" }),
		],
	])("refuses %s to a scoped manager", async (_name, call) => {
		mockState.actor.accessTier = "manager";
		mockState.actor.currentEmployee = { id: "manager-employee-1", role: "manager" };
		mockState.selectQueue = [[{ id: "policy-1" }]];

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.insertValues).not.toHaveBeenCalled();
		expect(mockState.updateSet).not.toHaveBeenCalled();
		expect(mockState.deleteWhere).not.toHaveBeenCalled();
	});
});
