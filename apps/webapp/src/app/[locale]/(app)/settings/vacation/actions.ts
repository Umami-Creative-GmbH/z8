"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import type { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	approvalPolicyCondition,
	employee,
	employeeVacationAllowance,
	payrollWageTypeMapping,
	timeRecordAbsence,
	vacationAdjustment,
	vacationAllowance,
} from "@/db/schema";
import type { LocaleTranslationMap } from "@/db/schema/absence";
import { findAbsenceCategoryRuleConflict } from "@/lib/absences/category-rules";
import { canRequireDeputy } from "@/lib/absences/deputy";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { CACHE_TAGS } from "@/lib/cache/tags";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
	requireSettingsActorEmployeeRecord,
} from "../employees/employee-action-utils";

export type AbsenceCategoryType =
	| "home_office"
	| "sick"
	| "vacation"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom"
	| "time_off_in_lieu";

type AbsenceCategoryWriteData = {
	type: AbsenceCategoryType;
	name: string;
	description?: string | null;
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	/** Time off in lieu (#1000); false when omitted. */
	drawsOnWorkBalance?: boolean;
	/** Absences of this category must name a deputy (#1011); off when left out. */
	deputyRequired?: boolean;
	color?: string | null;
	isActive?: boolean;
};

function normalizeOptionalText(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function isUnsafeTranslationKey(key: string) {
	return key === "__proto__" || key === "constructor" || key === "prototype";
}

function normalizeTranslationMap(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	const entries = Object.entries(value).flatMap(([locale, translation]) => {
		if (typeof locale !== "string" || typeof translation !== "string") return [];
		const trimmedLocale = locale.trim();
		const trimmedTranslation = translation.trim();
		return trimmedLocale && trimmedTranslation && !isUnsafeTranslationKey(trimmedLocale)
			? [[trimmedLocale, trimmedTranslation] as const]
			: [];
	});

	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeAbsenceCategoryData(data: AbsenceCategoryWriteData) {
	const name = data.name.trim();
	return {
		...data,
		name,
		description: normalizeOptionalText(data.description),
		nameTranslations: normalizeTranslationMap(data.nameTranslations),
		descriptionTranslations: normalizeTranslationMap(data.descriptionTranslations),
		drawsOnWorkBalance: data.drawsOnWorkBalance ?? false,
		color: normalizeOptionalText(data.color),
		// Sick leave never requires a deputy (#1011).
		...(data.deputyRequired !== undefined || data.type === "sick"
			? { deputyRequired: canRequireDeputy(data.type) && data.deputyRequired === true }
			: {}),
	};
}

function rejectBlankAbsenceCategoryName() {
	return Effect.fail(
		new ConflictError({
			message: "Absence category name cannot be blank",
			conflictType: "invalid_absence_category_name",
		}),
	);
}

function rejectConflictingAbsenceCategoryRules(
	normalized: ReturnType<typeof normalizeAbsenceCategoryData>,
) {
	const conflict = findAbsenceCategoryRuleConflict(normalized);
	if (!conflict) return Effect.void;
	return Effect.fail(
		new ConflictError({
			message:
				'"Draws on work balance" cannot be combined with "Counts against vacation" or "Requires work time".',
			conflictType: "invalid_absence_category_rules",
			details: { conflict },
		}),
	);
}

type AbsenceCategoryReferenceQueryable =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

async function hasAbsenceCategoryAbsenceReferences(
	dbClient: AbsenceCategoryReferenceQueryable,
	categoryId: string,
	organizationId: string,
) {
	const [referencedAbsence] = await dbClient
		.select({ id: absenceEntry.id })
		.from(absenceEntry)
		.where(eq(absenceEntry.categoryId, categoryId))
		.limit(1);

	if (referencedAbsence) {
		return true;
	}

	const [referencedCanonicalAbsence] = await dbClient
		.select({ recordId: timeRecordAbsence.recordId })
		.from(timeRecordAbsence)
		.where(
			and(
				eq(timeRecordAbsence.absenceCategoryId, categoryId),
				eq(timeRecordAbsence.organizationId, organizationId),
			),
		)
		.limit(1);

	return Boolean(referencedCanonicalAbsence);
}

function hasOperationalAbsenceCategoryChanges(
	category: typeof absenceCategory.$inferSelect,
	normalized: ReturnType<typeof normalizeAbsenceCategoryData>,
) {
	return (
		category.type !== normalized.type ||
		category.requiresWorkTime !== normalized.requiresWorkTime ||
		category.requiresApproval !== normalized.requiresApproval ||
		category.countsAgainstVacation !== normalized.countsAgainstVacation ||
		category.drawsOnWorkBalance !== normalized.drawsOnWorkBalance
	);
}

/**
 * Get a vacation policy by ID using Effect pattern
 */
export async function getVacationPolicy(
	policyId: string,
): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect | null>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "getVacationPolicy:actor" });
		const dbService = yield* DatabaseService;

		const policy = yield* dbService.query("getVacationPolicy", async () => {
			return await dbService.db.query.vacationAllowance.findFirst({
				where: eq(vacationAllowance.id, policyId),
				with: {
					creator: true,
				},
			});
		});

		if (!policy) {
			return null;
		}

		if (actor.organizationId !== policy.organizationId) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions",
					userId: actor.session.user.id,
					resource: "vacation_policy",
					action: "read",
				}),
			);
		}

		return policy;
	});

	return runServerActionSafe(effect);
}

/**
 * Get the current company default policy for an organization
 */
export async function getCompanyDefaultVacationPolicy(
	organizationId: string,
): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect | null>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getCompanyDefaultVacationPolicy:actor",
		});

		if (actor.organizationId !== organizationId) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions",
					userId: actor.session.user.id,
					resource: "vacation_policy",
					action: "read",
				}),
			);
		}

		// Step 3: Get current company default policy
		const dbService = yield* DatabaseService;

		const policy = yield* dbService.query("getCompanyDefaultPolicy", async () => {
			// Get the active company default where startDate <= today and (validUntil is null or >= today)
			return await dbService.db.query.vacationAllowance.findFirst({
				where: and(
					eq(vacationAllowance.organizationId, organizationId),
					eq(vacationAllowance.isCompanyDefault, true),
					eq(vacationAllowance.isActive, true),
				),
				with: {
					creator: true,
				},
				orderBy: desc(vacationAllowance.startDate),
			});
		});

		return policy || null;
	});

	return runServerActionSafe(effect);
}

/**
 * Create vacation policy for an organization using Effect pattern
 */
export async function createVacationPolicy(data: {
	organizationId: string;
	name: string;
	startDate: string; // YYYY-MM-DD
	validUntil?: string | null; // YYYY-MM-DD or null for ongoing
	isCompanyDefault?: boolean;
	defaultAnnualDays: string;
	accrualType: "annual" | "monthly" | "biweekly";
	accrualStartMonth?: number;
	allowCarryover: boolean;
	maxCarryoverDays?: string;
	carryoverExpiryMonths?: number;
}): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId: data.organizationId,
			queryName: "createVacationPolicy:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "vacation_policy",
			action: "create",
		});

		const dbService = yield* DatabaseService;

		// Step 4: If this is a company default, close the previous default
		if (data.isCompanyDefault) {
			yield* dbService.query("closePreviousDefault", async () => {
				// Find current active default
				const currentDefault = await dbService.db.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.organizationId, data.organizationId),
						eq(vacationAllowance.isCompanyDefault, true),
						eq(vacationAllowance.isActive, true),
					),
				});

				if (currentDefault && !currentDefault.validUntil) {
					// Calculate validUntil as day before new policy starts
					const newStartDate = new Date(data.startDate);
					newStartDate.setDate(newStartDate.getDate() - 1);
					const validUntil = newStartDate.toISOString().split("T")[0];

					// Update the old policy
					await dbService.db
						.update(vacationAllowance)
						.set({
							validUntil,
							isCompanyDefault: false,
						})
						.where(eq(vacationAllowance.id, currentDefault.id));
				}
			});
		}

		// Step 5: Create vacation policy
		const [policy] = yield* dbService
			.query("createVacationPolicy", async () => {
				return await dbService.db
					.insert(vacationAllowance)
					.values({
						organizationId: data.organizationId,
						name: data.name,
						startDate: data.startDate,
						validUntil: data.validUntil || null,
						isCompanyDefault: data.isCompanyDefault || false,
						isActive: true,
						defaultAnnualDays: data.defaultAnnualDays,
						accrualType: data.accrualType,
						accrualStartMonth: data.accrualStartMonth,
						allowCarryover: data.allowCarryover,
						maxCarryoverDays: data.maxCarryoverDays,
						carryoverExpiryMonths: data.carryoverExpiryMonths,
						createdBy: actor.session.user.id,
					})
					.returning();
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create vacation policy",
							operation: "insert",
							table: "vacation_allowance",
							cause: error,
						}),
				),
			);

		revalidateTag(CACHE_TAGS.VACATION_POLICY(data.organizationId), "max");

		return policy;
	});

	return runServerActionSafe(effect);
}

/**
 * Update vacation policy using Effect pattern
 */
export async function updateVacationPolicy(
	policyId: string,
	data: {
		name: string;
		startDate?: string; // YYYY-MM-DD
		validUntil?: string | null;
		isCompanyDefault?: boolean;
		defaultAnnualDays: string;
		accrualType: "annual" | "monthly" | "biweekly";
		accrualStartMonth?: number;
		allowCarryover: boolean;
		maxCarryoverDays?: string;
		carryoverExpiryMonths?: number;
	},
): Promise<ServerActionResult<typeof vacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "updateVacationPolicy:actor",
		});
		const dbService = yield* DatabaseService;

		// Step 3: Get the policy to check permissions
		const policy = yield* dbService
			.query("getPolicy", async () => {
				const p = await dbService.db.query.vacationAllowance.findFirst({
					where: eq(vacationAllowance.id, policyId),
				});

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Policy not found",
							entityType: "vacation_policy",
							entityId: policyId,
						}),
				),
			);

		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "vacation_policy",
			action: "update",
		});

		// Step 5: If setting as company default, unset previous default
		if (data.isCompanyDefault && !policy.isCompanyDefault) {
			yield* dbService.query("unsetPreviousDefault", async () => {
				await dbService.db
					.update(vacationAllowance)
					.set({ isCompanyDefault: false })
					.where(
						and(
							eq(vacationAllowance.organizationId, policy.organizationId),
							eq(vacationAllowance.isCompanyDefault, true),
							eq(vacationAllowance.isActive, true),
						),
					);
			});
		}

		// Step 6: Update vacation policy
		const [updated] = yield* dbService
			.query("updateVacationPolicy", async () => {
				return await dbService.db
					.update(vacationAllowance)
					.set({
						name: data.name,
						startDate: data.startDate,
						validUntil: data.validUntil,
						isCompanyDefault: data.isCompanyDefault,
						defaultAnnualDays: data.defaultAnnualDays,
						accrualType: data.accrualType,
						accrualStartMonth: data.accrualStartMonth,
						allowCarryover: data.allowCarryover,
						maxCarryoverDays: data.maxCarryoverDays,
						carryoverExpiryMonths: data.carryoverExpiryMonths,
					})
					.where(eq(vacationAllowance.id, policyId))
					.returning();
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to update vacation policy",
							operation: "update",
							table: "vacation_allowance",
							cause: error,
						}),
				),
			);

		revalidateTag(CACHE_TAGS.VACATION_POLICY(policy.organizationId), "max");

		return updated;
	});

	return runServerActionSafe(effect);
}

/**
 * Get all employees with their vacation allowances using Effect pattern
 */
export async function getEmployeesWithAllowances(
	organizationId: string,
	year: number,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getEmployeesWithAllowances:actor",
		});
		const dbService = yield* DatabaseService;
		const managedEmployeeIds = yield* getManagedEmployeeIdsForSettingsActor(actor);
		const employees = yield* dbService.query("getEmployeesWithAllowances", async () => {
			return await dbService.db.query.employee.findMany({
				where: eq(employee.organizationId, organizationId),
				with: {
					user: true,
					team: true,
					vacationAllowances: {
						where: eq(employeeVacationAllowance.year, year),
					},
				},
			});
		});

		if (!managedEmployeeIds) {
			return employees;
		}

		return employees.filter((employeeRecord) => managedEmployeeIds.has(employeeRecord.id));
	});

	return runServerActionSafe(effect);
}

/**
 * Get employee vacation allowance for a specific year using Effect pattern
 */
export async function getEmployeeAllowance(
	employeeId: string,
	year: number,
): Promise<ServerActionResult<any | null>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "getEmployeeAllowance:actor",
		});
		const dbService = yield* DatabaseService;

		// Step 3: Get employee
		const emp = yield* dbService
			.query("getEmployee", async () => {
				const e = await dbService.db.query.employee.findFirst({
					where: eq(employee.id, employeeId),
					with: {
						user: true,
						team: true,
						vacationAllowances: {
							where: eq(employeeVacationAllowance.year, year),
						},
					},
				});

				if (!e) {
					throw new Error("Employee not found");
				}

				return e;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: employeeId,
						}),
				),
			);

		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, emp, {
			message: "Insufficient permissions",
			resource: "employee_allowance",
			action: "read",
		});

		return emp;
	});

	return runServerActionSafe(effect);
}

/**
 * Update employee vacation allowance using Effect pattern
 */
export async function updateEmployeeAllowance(
	employeeId: string,
	year: number,
	data: {
		customAnnualDays?: string;
		customCarryoverDays?: string;
	},
): Promise<ServerActionResult<typeof employeeVacationAllowance.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "updateEmployeeAllowance:actor",
		});
		const dbService = yield* DatabaseService;

		const emp = yield* getTargetEmployee(employeeId, "updateEmployeeAllowance:getTargetEmployee");
		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, emp, {
			message: "Insufficient permissions",
			resource: "employee_allowance",
			action: "update",
		});

		// Step 6: Check if allowance exists
		const existing = yield* dbService.query("checkExistingAllowance", async () => {
			return await dbService.db.query.employeeVacationAllowance.findFirst({
				where: and(
					eq(employeeVacationAllowance.employeeId, employeeId),
					eq(employeeVacationAllowance.year, year),
				),
			});
		});

		// Step 7: Update or create allowance
		const allowance = yield* dbService
			.query("upsertEmployeeAllowance", async () => {
				if (existing) {
					// Update existing
					const [updated] = await dbService.db
						.update(employeeVacationAllowance)
						.set({
							customAnnualDays: data.customAnnualDays,
							customCarryoverDays: data.customCarryoverDays,
						})
						.where(eq(employeeVacationAllowance.id, existing.id))
						.returning();
					return updated;
				}

				// Create new
				const [created] = await dbService.db
					.insert(employeeVacationAllowance)
					.values({
						employeeId,
						year,
						customAnnualDays: data.customAnnualDays,
						customCarryoverDays: data.customCarryoverDays,
					})
					.returning();
				return created;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to update employee allowance",
							operation: existing ? "update" : "insert",
							table: "employee_vacation_allowance",
							cause: error,
						}),
				),
			);

		return allowance;
	});

	return runServerActionSafe(effect);
}

/**
 * Create a vacation adjustment for an employee
 */
export async function createVacationAdjustmentAction(
	employeeId: string,
	year: number,
	data: {
		days: string;
		reason: string;
	},
): Promise<ServerActionResult<typeof vacationAdjustment.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "createVacationAdjustmentAction:actor",
		});
		const dbService = yield* DatabaseService;

		const emp = yield* getTargetEmployee(
			employeeId,
			"createVacationAdjustmentAction:getTargetEmployee",
		);
		const actorEmployee = yield* requireSettingsActorEmployeeRecord(actor, {
			message: "Employee profile not found for vacation adjustment",
			resource: "employee",
			action: "create",
		});
		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, emp, {
			message: "Insufficient permissions",
			resource: "vacation_adjustment",
			action: "create",
		});

		// Step 6: Create the adjustment event
		const adjustment = yield* dbService
			.query("createVacationAdjustment", async () => {
				const [created] = await dbService.db
					.insert(vacationAdjustment)
					.values({
						employeeId,
						year,
						days: data.days,
						reason: data.reason,
						adjustedBy: actorEmployee.id,
					})
					.returning();
				return created;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create vacation adjustment",
							operation: "insert",
							table: "vacation_adjustment",
							cause: error,
						}),
				),
			);

		// Step 7: Log to central audit log
		yield* Effect.promise(async () => {
			await logAudit({
				action: AuditAction.VACATION_ALLOWANCE_UPDATED,
				actorId: actor.session.user.id,
				actorEmail: actor.session.user.email,
				targetId: employeeId,
				targetType: "vacation",
				organizationId: emp.organizationId,
				employeeId: employeeId,
				timestamp: new Date(),
				changes: {
					adjustmentDays: data.days,
				},
				metadata: {
					year,
					reason: data.reason,
					employeeId: emp.id,
					adjustmentId: adjustment.id,
				},
			});
		});

		return adjustment;
	});

	return runServerActionSafe(effect);
}

/**
 * Get all vacation policies for an organization, ordered by startDate descending
 */
export async function getVacationPolicies(
	organizationId: string,
): Promise<ServerActionResult<(typeof vacationAllowance.$inferSelect)[]>> {
	const effect = Effect.gen(function* () {
		yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getVacationPolicies:actor",
		});
		const dbService = yield* DatabaseService;
		const policies = yield* dbService.query("getVacationPolicies", async () => {
			return await dbService.db.query.vacationAllowance.findMany({
				where: and(
					eq(vacationAllowance.organizationId, organizationId),
					eq(vacationAllowance.isActive, true),
				),
				with: {
					creator: true,
				},
				orderBy: (table, { desc: descOrder, asc }) => [descOrder(table.startDate), asc(table.name)],
			});
		});

		return policies;
	});

	return runServerActionSafe(effect);
}

export async function getAbsenceCategoriesForSettings(
	organizationId: string,
): Promise<ServerActionResult<(typeof absenceCategory.$inferSelect)[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "getAbsenceCategoriesForSettings:actor",
		});

		if (actor.organizationId !== organizationId) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions",
					userId: actor.session.user.id,
					resource: "absence_category",
					action: "read",
				}),
			);
		}

		const dbService = yield* DatabaseService;
		return yield* dbService
			.query("getAbsenceCategoriesForSettings", async () => {
				return await dbService.db.query.absenceCategory.findMany({
					where: eq(absenceCategory.organizationId, organizationId),
					orderBy: (table, { desc: descOrder, asc }) => [
						descOrder(table.isActive),
						asc(table.name),
						asc(table.createdAt),
					],
				});
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to fetch absence categories",
							operation: "select",
							table: "absence_category",
							cause: error,
						}),
				),
			);
	});

	return runServerActionSafe(effect);
}

export async function createAbsenceCategory(
	data: AbsenceCategoryWriteData & { organizationId: string },
): Promise<ServerActionResult<typeof absenceCategory.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "createAbsenceCategory:actor",
		});

		if (actor.organizationId !== data.organizationId) {
			yield* Effect.fail(
				new AuthorizationError({
					message: "Insufficient permissions",
					userId: actor.session.user.id,
					resource: "absence_category",
					action: "create",
				}),
			);
		}

		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "absence_category",
			action: "create",
		});

		const normalized = normalizeAbsenceCategoryData(data);
		if (!normalized.name) {
			yield* rejectBlankAbsenceCategoryName();
		}
		yield* rejectConflictingAbsenceCategoryRules(normalized);

		const dbService = yield* DatabaseService;
		const [created] = yield* dbService
			.query("createAbsenceCategory", async () => {
				return await dbService.db
					.insert(absenceCategory)
					.values({
						organizationId: data.organizationId,
						type: normalized.type,
						name: normalized.name,
						description: normalized.description,
						nameTranslations: normalized.nameTranslations,
						descriptionTranslations: normalized.descriptionTranslations,
						requiresWorkTime: normalized.requiresWorkTime,
						requiresApproval: normalized.requiresApproval,
						countsAgainstVacation: normalized.countsAgainstVacation,
						drawsOnWorkBalance: normalized.drawsOnWorkBalance,
						deputyRequired: normalized.deputyRequired ?? false,
						color: normalized.color,
						isActive: data.isActive ?? true,
					})
					.returning();
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create absence category",
							operation: "insert",
							table: "absence_category",
							cause: error,
						}),
				),
			);

		return created;
	});

	return runServerActionSafe(effect);
}

export async function updateAbsenceCategory(
	categoryId: string,
	data: AbsenceCategoryWriteData & { isActive: boolean },
): Promise<ServerActionResult<typeof absenceCategory.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "updateAbsenceCategory:actor",
		});
		const dbService = yield* DatabaseService;
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "absence_category",
			action: "update",
		});

		const normalized = normalizeAbsenceCategoryData(data);
		if (!normalized.name) {
			yield* rejectBlankAbsenceCategoryName();
		}
		yield* rejectConflictingAbsenceCategoryRules(normalized);

		const updateResult = yield* dbService
			.query("updateAbsenceCategory", async () => {
				return await dbService.db.transaction(async (tx) => {
					const [category] = await tx
						.select()
						.from(absenceCategory)
						.where(
							and(
								eq(absenceCategory.id, categoryId),
								eq(absenceCategory.organizationId, actor.organizationId),
							),
						)
						.for("update");

					if (!category) {
						return { type: "not_found" as const };
					}

					const hasAbsenceReferences = await hasAbsenceCategoryAbsenceReferences(
						tx,
						category.id,
						actor.organizationId,
					);

					if (hasAbsenceReferences && hasOperationalAbsenceCategoryChanges(category, normalized)) {
						return { type: "conflict" as const };
					}

					const [updated] = await tx
						.update(absenceCategory)
						.set({
							type: normalized.type,
							name: normalized.name,
							description: normalized.description,
							nameTranslations: normalized.nameTranslations,
							descriptionTranslations: normalized.descriptionTranslations,
							requiresWorkTime: normalized.requiresWorkTime,
							requiresApproval: normalized.requiresApproval,
							countsAgainstVacation: normalized.countsAgainstVacation,
							drawsOnWorkBalance: normalized.drawsOnWorkBalance,
							// Changing it never affects existing absences until their deputy changes.
							deputyRequired: normalized.deputyRequired ?? category.deputyRequired,
							color: normalized.color,
							isActive: data.isActive,
						})
						.where(
							and(
								eq(absenceCategory.id, categoryId),
								eq(absenceCategory.organizationId, actor.organizationId),
							),
						)
						.returning();

					if (!updated) {
						return { type: "not_found" as const };
					}

					return { type: "updated" as const, category: updated };
				});
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to update absence category",
							operation: "update",
							table: "absence_category",
							cause: error,
						}),
				),
			);

		if (updateResult.type === "not_found") {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Absence category not found",
					entityType: "absence_category",
					entityId: categoryId,
				}),
			);
		}

		if (updateResult.type === "conflict") {
			return yield* Effect.fail(
				new ConflictError({
					message:
						"This category is used by existing absences. Create a new category for different rules, or deactivate this one.",
					conflictType: "absence_category_in_use",
					details: { categoryId },
				}),
			);
		}

		return updateResult.category;
	});

	return runServerActionSafe(effect);
}

export async function setAbsenceCategoryActive(
	categoryId: string,
	isActive: boolean,
): Promise<ServerActionResult<typeof absenceCategory.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "setAbsenceCategoryActive:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "absence_category",
			action: "update",
		});

		const dbService = yield* DatabaseService;
		const category = yield* dbService.query("getAbsenceCategory", async () => {
			return await dbService.db.query.absenceCategory.findFirst({
				where: and(
					eq(absenceCategory.id, categoryId),
					eq(absenceCategory.organizationId, actor.organizationId),
				),
			});
		});
		if (!category) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Absence category not found",
					entityType: "absence_category",
					entityId: categoryId,
				}),
			);
		}

		const [updated] = yield* dbService
			.query("setAbsenceCategoryActive", async () => {
				return await dbService.db
					.update(absenceCategory)
					.set({ isActive })
					.where(
						and(
							eq(absenceCategory.id, categoryId),
							eq(absenceCategory.organizationId, actor.organizationId),
						),
					)
					.returning();
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to update absence category status",
							operation: "update",
							table: "absence_category",
							cause: error,
						}),
				),
			);

		if (!updated) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Absence category not found",
					entityType: "absence_category",
					entityId: categoryId,
				}),
			);
		}

		return updated;
	});

	return runServerActionSafe(effect);
}

export async function deleteAbsenceCategory(
	categoryId: string,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deleteAbsenceCategory:actor",
		});
		const dbService = yield* DatabaseService;
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "absence_category",
			action: "delete",
		});

		const deleteResult = yield* dbService
			.query("deleteAbsenceCategory", async () => {
				return await dbService.db.transaction(async (tx) => {
					const [category] = await tx
						.select({ id: absenceCategory.id })
						.from(absenceCategory)
						.where(
							and(
								eq(absenceCategory.id, categoryId),
								eq(absenceCategory.organizationId, actor.organizationId),
							),
						)
						.for("update");

					if (!category) {
						return { type: "not_found" as const };
					}

					const hasAbsenceReferences = await hasAbsenceCategoryAbsenceReferences(
						tx,
						category.id,
						actor.organizationId,
					);

					if (hasAbsenceReferences) {
						return {
							type: "conflict" as const,
							message: "Deactivate this category instead because it is used by existing absences.",
						};
					}

					const [referencedApprovalPolicyCondition] = await tx
						.select({ id: approvalPolicyCondition.id })
						.from(approvalPolicyCondition)
						.where(
							and(
								eq(approvalPolicyCondition.absenceCategoryId, category.id),
								eq(approvalPolicyCondition.organizationId, actor.organizationId),
							),
						)
						.limit(1);

					if (referencedApprovalPolicyCondition) {
						return {
							type: "conflict" as const,
							message:
								"Deactivate this category or remove dependent approval policies before deleting it.",
						};
					}

					const [referencedPayrollWageTypeMapping] = await tx
						.select({ id: payrollWageTypeMapping.id })
						.from(payrollWageTypeMapping)
						.where(
							and(
								eq(payrollWageTypeMapping.absenceCategoryId, category.id),
								eq(payrollWageTypeMapping.organizationId, actor.organizationId),
							),
						)
						.limit(1);

					if (referencedPayrollWageTypeMapping) {
						return {
							type: "conflict" as const,
							message:
								"Deactivate this category or remove dependent payroll wage type mappings before deleting it.",
						};
					}

					await tx
						.delete(absenceCategory)
						.where(
							and(
								eq(absenceCategory.id, categoryId),
								eq(absenceCategory.organizationId, actor.organizationId),
							),
						);

					return { type: "deleted" as const };
				});
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to delete absence category",
							operation: "delete",
							table: "absence_category",
							cause: error,
						}),
				),
			);

		if (deleteResult.type === "not_found") {
			yield* Effect.fail(
				new NotFoundError({
					message: "Absence category not found",
					entityType: "absence_category",
					entityId: categoryId,
				}),
			);
		}

		if (deleteResult.type === "conflict") {
			yield* Effect.fail(
				new ConflictError({
					message: deleteResult.message,
					conflictType: "absence_category_in_use",
					details: { categoryId },
				}),
			);
		}

		return { id: categoryId };
	});

	return runServerActionSafe(effect);
}

/**
 * @deprecated No longer needed - policies are now date-based, not year-based
 * Get available years for vacation policies in an organization
 */
export async function getVacationPolicyYears(
	_organizationId: string,
): Promise<ServerActionResult<number[]>> {
	// Return empty array - this function is deprecated
	return { success: true, data: [] };
}

/**
 * Delete a vacation policy using Effect pattern (soft delete - sets isActive=false)
 */
export async function deleteVacationPolicy(policyId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deleteVacationPolicy:actor",
		});
		const dbService = yield* DatabaseService;

		// Step 3: Get the policy to check permissions
		const policy = yield* dbService
			.query("getPolicy", async () => {
				const p = await dbService.db.query.vacationAllowance.findFirst({
					where: eq(vacationAllowance.id, policyId),
				});

				if (!p) {
					throw new Error("Policy not found");
				}

				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Policy not found",
							entityType: "vacation_policy",
							entityId: policyId,
						}),
				),
			);

		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Insufficient permissions",
			resource: "vacation_policy",
			action: "delete",
		});

		// Step 5: Prevent deleting the only active company default
		if (policy.isCompanyDefault) {
			// Check if there's another active company default
			const otherDefaults = yield* dbService.query("checkOtherDefaults", async () => {
				return await dbService.db.query.vacationAllowance.findMany({
					where: and(
						eq(vacationAllowance.organizationId, policy.organizationId),
						eq(vacationAllowance.isCompanyDefault, true),
						eq(vacationAllowance.isActive, true),
					),
				});
			});

			if (otherDefaults.length <= 1) {
				yield* Effect.fail(
					new ConflictError({
						message:
							"Cannot delete the only company default policy. Set another policy as default first.",
						conflictType: "last_company_default",
						details: { policyId },
					}),
				);
			}
		}

		// Step 6: Soft delete the policy (set isActive=false)
		yield* dbService
			.query("deleteVacationPolicy", async () => {
				await dbService.db
					.update(vacationAllowance)
					.set({ isActive: false })
					.where(eq(vacationAllowance.id, policyId));
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to delete vacation policy",
							operation: "update",
							table: "vacation_allowance",
							cause: error,
						}),
				),
			);

		revalidateTag(CACHE_TAGS.VACATION_POLICY(policy.organizationId), "max");
	});

	return runServerActionSafe(effect);
}

/**
 * Get the sum of vacation adjustments for an employee in a specific year
 */
export async function getEmployeeAdjustmentTotal(
	employeeId: string,
	year: number,
): Promise<ServerActionResult<number>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "getEmployeeAdjustmentTotal:actor",
		});
		const dbService = yield* DatabaseService;

		const emp = yield* getTargetEmployee(
			employeeId,
			"getEmployeeAdjustmentTotal:getTargetEmployee",
		);
		yield* ensureSettingsActorCanAccessEmployeeTarget(actor, emp, {
			message: "Insufficient permissions",
			resource: "vacation_adjustment",
			action: "read",
		});

		// Step 5: Get adjustment total
		const result = yield* dbService.query("getAdjustmentTotal", async () => {
			const rows = await dbService.db
				.select()
				.from(vacationAdjustment)
				.where(
					and(eq(vacationAdjustment.employeeId, employeeId), eq(vacationAdjustment.year, year)),
				);

			return rows.reduce((sum, row) => sum + parseFloat(row.days), 0);
		});

		return result;
	});

	return runServerActionSafe(effect);
}
