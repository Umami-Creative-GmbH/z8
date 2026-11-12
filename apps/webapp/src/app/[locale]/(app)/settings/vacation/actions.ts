"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
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
import type { VacationBalance, VacationBalanceConfiguration } from "@/lib/absences/types";
import {
	loadManualVacationAdjustments,
	loadVacationAdjustmentSums,
	type ManualVacationAdjustment,
	type VacationAdjustmentSums,
} from "@/lib/absences/vacation-adjustments";
import { loadVacationBalances } from "@/lib/absences/vacation-balance-store";
import { vacationPolicyWriteFailure } from "@/lib/absences/vacation-policy-assignment-write";
import {
	checkStatutoryMinimumDays,
	defaultStatutoryMinimumDays,
	isAccrualPolicy,
} from "@/lib/absences/vacation-policy-settings";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { calendarYearAt, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { findManagedEmployee } from "./managed-employee";

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

const absenceCategoryTypeSchema = z.enum([
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
	"custom",
	"time_off_in_lieu",
]);

const translationMapSchema = z.record(z.string(), z.string()).nullish();

const absenceCategoryWriteSchema = z.object({
	type: absenceCategoryTypeSchema,
	name: z.string(),
	description: z.string().nullish(),
	nameTranslations: translationMapSchema,
	descriptionTranslations: translationMapSchema,
	requiresWorkTime: z.boolean(),
	requiresApproval: z.boolean(),
	countsAgainstVacation: z.boolean(),
	/** Time off in lieu (#1000); false when omitted. */
	drawsOnWorkBalance: z.boolean().optional(),
	/** Absences of this category must name a deputy (#1011); off when left out. */
	deputyRequired: z.boolean().optional(),
	color: z.string().nullish(),
	isActive: z.boolean().optional(),
});

type AbsenceCategoryWriteData = z.output<typeof absenceCategoryWriteSchema> & {
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
};

export type AbsenceCategoryInput = z.input<typeof absenceCategoryWriteSchema>;

const policyFieldsSchema = {
	name: z.string(),
	validUntil: z.string().nullish(), // YYYY-MM-DD or null for ongoing
	isCompanyDefault: z.boolean().optional(),
	defaultAnnualDays: z.string(),
	accrualType: z.enum(["annual", "monthly", "biweekly"]),
	accrualStartMonth: z.number().int().optional(),
	allowCarryover: z.boolean(),
	maxCarryoverDays: z.string().optional(),
	carryoverExpiryMonths: z.number().int().nullish(),
	/** Prorate in start and exit year (#1109). */
	prorateInStartAndExitYear: z.boolean().optional(),
	/** Floor of the prorated allowance (#1109). */
	statutoryMinimumDays: z.string().optional(),
};

const createVacationPolicySchema = z.object({
	...policyFieldsSchema,
	startDate: z.string(), // YYYY-MM-DD
});

const updateVacationPolicySchema = z.object({
	policyId: z.string().min(1),
	data: z.object({
		...policyFieldsSchema,
		startDate: z.string().optional(), // YYYY-MM-DD
	}),
});

export type CreateVacationPolicyInput = z.input<typeof createVacationPolicySchema>;
export type UpdateVacationPolicyInput = z.input<typeof updateVacationPolicySchema>["data"];

const employeeYearSchema = z.object({
	employeeId: z.string().min(1),
	year: z.number().int(),
});

const idSchema = z.string().min(1);

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
			? {
					deputyRequired: canRequireDeputy(data.type) && data.deputyRequired === true,
				}
			: {}),
	};
}

const STATUTORY_MINIMUM_DAYS_MESSAGES = {
	not_a_number: "The statutory minimum must be a number",
	negative: "The statutory minimum cannot be negative",
	above_annual_days: "The statutory minimum cannot exceed the policy's annual days",
} as const;

function rejectInvalidStatutoryMinimumDays(
	statutoryMinimumDays: string,
	defaultAnnualDays: string,
) {
	const problem = checkStatutoryMinimumDays(statutoryMinimumDays, defaultAnnualDays);
	if (!problem) return Effect.void;
	return Effect.fail(
		new ValidationError({
			message: STATUTORY_MINIMUM_DAYS_MESSAGES[problem],
			field: "statutoryMinimumDays",
			value: statutoryMinimumDays,
		}),
	);
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

/** The category with its name and rules checked, ready to save. */
function normalizedAbsenceCategory(data: AbsenceCategoryWriteData) {
	return Effect.gen(function* () {
		const normalized = normalizeAbsenceCategoryData(data);
		if (!normalized.name) {
			return yield* rejectBlankAbsenceCategoryName();
		}
		yield* rejectConflictingAbsenceCategoryRules(normalized);
		return normalized;
	});
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

function dbError(message: string, operation: string, table: string) {
	return (cause: unknown) => new DatabaseError({ message, operation, table, cause });
}

function absenceCategoryNotFound(categoryId: string) {
	return Effect.fail(
		new NotFoundError({
			message: "Absence category not found",
			entityType: "absence_category",
			entityId: categoryId,
		}),
	);
}

function policyNotFound(policyId: string) {
	return Effect.fail(
		new NotFoundError({
			message: "Policy not found",
			entityType: "vacation_policy",
			entityId: policyId,
		}),
	);
}

function findPolicy(policyId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("getPolicy", () =>
			dbService.db.query.vacationAllowance.findFirst({
				where: and(
					eq(vacationAllowance.id, policyId),
					eq(vacationAllowance.organizationId, organizationId),
				),
			}),
		);
	});
}

/**
 * A vacation policy of the active organization; another organization's is not found (null).
 */
export const getVacationPolicy = organizationAction(
	{ name: "vacation.getPolicy", requires: "scopedManager", schema: idSchema },
	({ organizationId, input: policyId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const policy = yield* dbService.query("getVacationPolicy", () =>
				dbService.db.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.id, policyId),
						eq(vacationAllowance.organizationId, organizationId),
					),
					with: { creator: true },
				}),
			);
			return policy ?? null;
		}),
);

/**
 * The active organization's current company default policy
 */
export const getCompanyDefaultVacationPolicy = organizationAction(
	{ name: "vacation.companyDefaultPolicy", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const policy = yield* dbService.query("getCompanyDefaultPolicy", () =>
				dbService.db.query.vacationAllowance.findFirst({
					where: and(
						eq(vacationAllowance.organizationId, organizationId),
						eq(vacationAllowance.isCompanyDefault, true),
						eq(vacationAllowance.isActive, true),
					),
					with: { creator: true },
					orderBy: desc(vacationAllowance.startDate),
				}),
			);
			return policy || null;
		}),
);

/**
 * Create a vacation policy in the active organization
 */
export const createVacationPolicy = organizationAction(
	{ name: "vacation.createPolicy", requires: "orgAdmin", schema: createVacationPolicySchema },
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			const statutoryMinimumDays =
				data.statutoryMinimumDays ?? defaultStatutoryMinimumDays(data.defaultAnnualDays);
			yield* rejectInvalidStatutoryMinimumDays(statutoryMinimumDays, data.defaultAnnualDays);

			const dbService = yield* DatabaseService;
			const [policy] = yield* dbService
				.query("createVacationPolicy", () =>
					dbService.db.transaction(async (tx) => {
						await acquireExclusiveOrganizationConfigurationGuard(tx, organizationId);
						if (data.isCompanyDefault) {
							const currentDefault = await tx.query.vacationAllowance.findFirst({
								where: and(
									eq(vacationAllowance.organizationId, organizationId),
									eq(vacationAllowance.isCompanyDefault, true),
									eq(vacationAllowance.isActive, true),
								),
							});
							if (currentDefault && !currentDefault.validUntil) {
								const validUntil = Temporal.PlainDate.from(data.startDate)
									.subtract({ days: 1 })
									.toString();
								await tx
									.update(vacationAllowance)
									.set({ validUntil, isCompanyDefault: false })
									.where(
										and(
											eq(vacationAllowance.id, currentDefault.id),
											eq(vacationAllowance.organizationId, organizationId),
										),
									);
							}
						}
						return await tx
							.insert(vacationAllowance)
							.values({
								organizationId,
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
								prorateInStartAndExitYear: data.prorateInStartAndExitYear ?? true,
								statutoryMinimumDays,
								createdBy: actor.userId,
							})
							.returning();
					}),
				)
				.pipe(Effect.mapError(vacationPolicyWriteFailure));

			revalidateTag(CACHE_TAGS.VACATION_POLICY(organizationId), "max");

			return policy;
		}),
);

/**
 * Update a vacation policy of the active organization
 */
export const updateVacationPolicy = organizationAction(
	{ name: "vacation.updatePolicy", requires: "orgAdmin", schema: updateVacationPolicySchema },
	({ organizationId, input: { policyId, data } }) =>
		Effect.gen(function* () {
			const policy = yield* findPolicy(policyId, organizationId);
			if (!policy) {
				return yield* policyNotFound(policyId);
			}

			// The stored statutory minimum must still fit when only the annual days change.
			yield* rejectInvalidStatutoryMinimumDays(
				data.statutoryMinimumDays ?? policy.statutoryMinimumDays,
				data.defaultAnnualDays,
			);

			const dbService = yield* DatabaseService;
			const [updated] = yield* dbService
				.query("updateVacationPolicy", () =>
					dbService.db.transaction(async (tx) => {
						await acquireExclusiveOrganizationConfigurationGuard(tx, organizationId);
						const timezone = await loadOrganizationTimezone(tx, organizationId);
						const today = Temporal.Now.plainDateISO(timezone).toString();
						const effectiveStart = data.startDate ?? policy.startDate;
						const effectiveDate = effectiveStart > today ? effectiveStart : today;
						await tx.execute(
							sql`select set_config('z8.vacation_effective_date',${effectiveDate},true)`,
						);
						if (data.isCompanyDefault && !policy.isCompanyDefault) {
							await tx
								.update(vacationAllowance)
								.set({ isCompanyDefault: false })
								.where(
									and(
										eq(vacationAllowance.organizationId, organizationId),
										eq(vacationAllowance.isCompanyDefault, true),
										eq(vacationAllowance.isActive, true),
									),
								);
						}
						return await tx
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
								prorateInStartAndExitYear: data.prorateInStartAndExitYear,
								statutoryMinimumDays: data.statutoryMinimumDays,
							})
							.where(
								and(
									eq(vacationAllowance.id, policyId),
									eq(vacationAllowance.organizationId, organizationId),
								),
							)
							.returning();
					}),
				)
				.pipe(Effect.mapError(vacationPolicyWriteFailure));

			revalidateTag(CACHE_TAGS.VACATION_POLICY(organizationId), "max");

			return updated;
		}),
);

/**
 * The active organization's employees with their vacation allowances and
 * balances for a year; a scoped manager sees their reports.
 */
export const getEmployeesWithAllowances = organizationAction(
	{ name: "vacation.employeesWithAllowances", requires: "scopedManager", schema: z.number().int() },
	({ actor, organizationId, input: year }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getEmployeesWithAllowances", async () => {
				const records = await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					with: {
						user: true,
						team: true,
						vacationAllowances: {
							where: eq(employeeVacationAllowance.year, year),
						},
					},
				});
				const visible = scope.organizationWide
					? records
					: records.filter((employeeRecord) => scope.employeeIds.has(employeeRecord.id));
				// The same server-side balance as the employee's Absences page (#1111).
				const { balances, adjustments, configurations, policies } = await loadVacationBalances(
					dbService.db,
					{
						organizationId,
						employeeIds: visible.map((employeeRecord) => employeeRecord.id),
						year,
						timezone: await loadOrganizationTimezone(dbService.db, organizationId),
					},
				);
				return visible.map((employeeRecord) => {
					const policy = policies.get(employeeRecord.id);
					return {
						...employeeRecord,
						vacationBalance: balances.get(employeeRecord.id) ?? null,
						vacationConfiguration: configurations.get(employeeRecord.id) ?? null,
						vacationPolicy: policy
							? { name: policy.name, defaultAnnualDays: policy.defaultAnnualDays }
							: null,
						// The balance's manual and accrual adjustments for the year (#1105, #1106).
						vacationAdjustments: adjustments.get(employeeRecord.id) ?? null,
					};
				});
			});
		}),
);

/**
 * An employee's vacation allowance for a year
 */
export const getEmployeeAllowance = organizationAction(
	{ name: "vacation.employeeAllowance", requires: "scopedManager", schema: employeeYearSchema },
	({ actor, organizationId, input: { employeeId, year } }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, "employee_allowance", "read");
			const dbService = yield* DatabaseService;
			const emp = yield* dbService.query("getEmployee", () =>
				dbService.db.query.employee.findFirst({
					where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
					with: {
						user: true,
						team: true,
						vacationAllowances: {
							where: eq(employeeVacationAllowance.year, year),
						},
					},
				}),
			);
			if (!emp) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				);
			}
			return emp;
		}),
);

/**
 * Update an employee's vacation allowance for a year
 */
export const updateEmployeeAllowance = organizationAction(
	{
		name: "vacation.updateEmployeeAllowance",
		requires: "scopedManager",
		schema: employeeYearSchema.extend({
			data: z.object({
				customAnnualDays: z.string().optional(),
				customCarryoverDays: z.string().optional(),
			}),
		}),
	},
	({ actor, organizationId, input: { employeeId, year, data } }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, "employee_allowance", "update");
			const dbService = yield* DatabaseService;

			const existing = yield* dbService.query("checkExistingAllowance", () =>
				dbService.db.query.employeeVacationAllowance.findFirst({
					where: and(
						eq(employeeVacationAllowance.employeeId, employeeId),
						eq(employeeVacationAllowance.year, year),
					),
				}),
			);

			return yield* dbService
				.query("upsertEmployeeAllowance", async () => {
					if (existing) {
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
						dbError(
							"Failed to update employee allowance",
							existing ? "update" : "insert",
							"employee_vacation_allowance",
						),
					),
				);
		}),
);

/**
 * Record a manual vacation adjustment for an employee; it names the acting
 * employee, so the actor needs an employee record.
 */
export const createVacationAdjustmentAction = organizationAction(
	{
		name: "vacation.createAdjustment",
		requires: "scopedManager",
		schema: employeeYearSchema.extend({
			data: z.object({ days: z.string().min(1), reason: z.string() }),
		}),
	},
	({ actor, organizationId, input: { employeeId, year, data } }) =>
		Effect.gen(function* () {
			const adjustedBy = actor.employee?.id;
			if (!adjustedBy) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee profile not found for vacation adjustment",
						entityType: "employee",
						entityId: actor.userId,
					}),
				);
			}
			yield* findManagedEmployee(
				actor,
				organizationId,
				employeeId,
				"vacation_adjustment",
				"create",
			);
			const dbService = yield* DatabaseService;

			const adjustment = yield* dbService
				.query("createVacationAdjustment", async () => {
					const [created] = await dbService.db
						.insert(vacationAdjustment)
						.values({
							employeeId,
							year,
							days: data.days,
							reason: data.reason,
							kind: "manual",
							adjustedBy,
						})
						.returning();
					return created;
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to create vacation adjustment", "insert", "vacation_adjustment"),
					),
				);

			const [actorUser] = yield* dbService.query("vacation.adjustmentActorEmail", () =>
				dbService.db
					.select({ email: user.email })
					.from(user)
					.where(eq(user.id, actor.userId))
					.limit(1),
			);
			yield* Effect.promise(() =>
				logAudit({
					action: AuditAction.VACATION_ALLOWANCE_UPDATED,
					actorId: actor.userId,
					actorEmail: actorUser?.email,
					targetId: employeeId,
					targetType: "vacation",
					organizationId,
					employeeId,
					timestamp: new Date(),
					changes: { adjustmentDays: data.days },
					metadata: {
						year,
						reason: data.reason,
						employeeId,
						adjustmentId: adjustment.id,
					},
				}),
			);

			return adjustment;
		}),
);

/**
 * The active organization's vacation policies, newest start first
 */
export const getVacationPolicies = organizationAction(
	{ name: "vacation.listPolicies", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("getVacationPolicies", () =>
				dbService.db.query.vacationAllowance.findMany({
					where: and(
						eq(vacationAllowance.organizationId, organizationId),
						eq(vacationAllowance.isActive, true),
					),
					with: { creator: true },
					orderBy: (table, { desc: descOrder, asc }) => [
						descOrder(table.startDate),
						asc(table.name),
					],
				}),
			);
		}),
);

export const getAbsenceCategoriesForSettings = organizationAction(
	{ name: "vacation.listAbsenceCategories", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("getAbsenceCategoriesForSettings", () =>
					dbService.db.query.absenceCategory.findMany({
						where: eq(absenceCategory.organizationId, organizationId),
						orderBy: (table, { desc: descOrder, asc }) => [
							descOrder(table.isActive),
							asc(table.name),
							asc(table.createdAt),
						],
					}),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to fetch absence categories", "select", "absence_category"),
					),
				);
		}),
);

export const createAbsenceCategory = organizationAction(
	{
		name: "vacation.createAbsenceCategory",
		requires: "orgAdmin",
		schema: absenceCategoryWriteSchema,
	},
	({ organizationId, input: data }) =>
		Effect.gen(function* () {
			const normalized = yield* normalizedAbsenceCategory(data);

			const dbService = yield* DatabaseService;
			const [created] = yield* dbService
				.query("createAbsenceCategory", () =>
					dbService.db
						.insert(absenceCategory)
						.values({
							organizationId,
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
						.returning(),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to create absence category", "insert", "absence_category"),
					),
				);

			return created;
		}),
);

export const updateAbsenceCategory = organizationAction(
	{
		name: "vacation.updateAbsenceCategory",
		requires: "orgAdmin",
		schema: z.object({
			categoryId: z.string().min(1),
			data: absenceCategoryWriteSchema.extend({ isActive: z.boolean() }),
		}),
	},
	({ organizationId, input: { categoryId, data } }) =>
		Effect.gen(function* () {
			const normalized = yield* normalizedAbsenceCategory(data);

			const dbService = yield* DatabaseService;
			const updateResult = yield* dbService
				.query("updateAbsenceCategory", () =>
					dbService.db.transaction(async (tx) => {
						await acquireExclusiveOrganizationConfigurationGuard(tx, organizationId);
						const [category] = await tx
							.select()
							.from(absenceCategory)
							.where(
								and(
									eq(absenceCategory.id, categoryId),
									eq(absenceCategory.organizationId, organizationId),
								),
							)
							.for("update");

						if (!category) {
							return { type: "not_found" as const };
						}

						const hasAbsenceReferences = await hasAbsenceCategoryAbsenceReferences(
							tx,
							category.id,
							organizationId,
						);

						if (
							hasAbsenceReferences &&
							hasOperationalAbsenceCategoryChanges(category, normalized)
						) {
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
									eq(absenceCategory.organizationId, organizationId),
								),
							)
							.returning();

						if (!updated) {
							return { type: "not_found" as const };
						}

						return { type: "updated" as const, category: updated };
					}),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to update absence category", "update", "absence_category"),
					),
				);

			if (updateResult.type === "not_found") {
				return yield* absenceCategoryNotFound(categoryId);
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
		}),
);

export const setAbsenceCategoryActive = organizationAction(
	{
		name: "vacation.setAbsenceCategoryActive",
		requires: "orgAdmin",
		schema: z.strictObject({ categoryId: z.string().min(1), isActive: z.boolean() }),
	},
	({ organizationId, input: { categoryId, isActive } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [updated] = yield* dbService
				.query("setAbsenceCategoryActive", () =>
					dbService.db
						.update(absenceCategory)
						.set({ isActive })
						.where(
							and(
								eq(absenceCategory.id, categoryId),
								eq(absenceCategory.organizationId, organizationId),
							),
						)
						.returning(),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to update absence category status", "update", "absence_category"),
					),
				);

			if (!updated) {
				return yield* absenceCategoryNotFound(categoryId);
			}

			return updated;
		}),
);

export const deleteAbsenceCategory = organizationAction(
	{ name: "vacation.deleteAbsenceCategory", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: categoryId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const deleteResult = yield* dbService
				.query("deleteAbsenceCategory", () =>
					dbService.db.transaction(async (tx) => {
						const [category] = await tx
							.select({ id: absenceCategory.id })
							.from(absenceCategory)
							.where(
								and(
									eq(absenceCategory.id, categoryId),
									eq(absenceCategory.organizationId, organizationId),
								),
							)
							.for("update");

						if (!category) {
							return { type: "not_found" as const };
						}

						if (await hasAbsenceCategoryAbsenceReferences(tx, category.id, organizationId)) {
							return {
								type: "conflict" as const,
								message:
									"Deactivate this category instead because it is used by existing absences.",
							};
						}

						const [referencedApprovalPolicyCondition] = await tx
							.select({ id: approvalPolicyCondition.id })
							.from(approvalPolicyCondition)
							.where(
								and(
									eq(approvalPolicyCondition.absenceCategoryId, category.id),
									eq(approvalPolicyCondition.organizationId, organizationId),
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
									eq(payrollWageTypeMapping.organizationId, organizationId),
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
									eq(absenceCategory.organizationId, organizationId),
								),
							);

						return { type: "deleted" as const };
					}),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to delete absence category", "delete", "absence_category"),
					),
				);

			if (deleteResult.type === "not_found") {
				return yield* absenceCategoryNotFound(categoryId);
			}

			if (deleteResult.type === "conflict") {
				return yield* Effect.fail(
					new ConflictError({
						message: deleteResult.message,
						conflictType: "absence_category_in_use",
						details: { categoryId },
					}),
				);
			}

			return { id: categoryId };
		}),
);

/**
 * Deactivate a vacation policy of the active organization
 */
export const deleteVacationPolicy = organizationAction(
	{ name: "vacation.deletePolicy", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: policyId }) =>
		Effect.gen(function* () {
			const policy = yield* findPolicy(policyId, organizationId);
			if (!policy) {
				return yield* policyNotFound(policyId);
			}

			const dbService = yield* DatabaseService;
			// Prevent deleting the only active company default
			if (policy.isCompanyDefault) {
				const otherDefaults = yield* dbService.query("checkOtherDefaults", () =>
					dbService.db.query.vacationAllowance.findMany({
						where: and(
							eq(vacationAllowance.organizationId, organizationId),
							eq(vacationAllowance.isCompanyDefault, true),
							eq(vacationAllowance.isActive, true),
						),
					}),
				);

				if (otherDefaults.length <= 1) {
					return yield* Effect.fail(
						new ConflictError({
							message:
								"Cannot delete the only company default policy. Set another policy as default first.",
							conflictType: "last_company_default",
							details: { policyId },
						}),
					);
				}
			}

			yield* dbService
				.query("deleteVacationPolicy", async () => {
					await dbService.db
						.update(vacationAllowance)
						.set({ isActive: false })
						.where(
							and(
								eq(vacationAllowance.id, policyId),
								eq(vacationAllowance.organizationId, organizationId),
							),
						);
				})
				.pipe(Effect.mapError(vacationPolicyWriteFailure));

			revalidateTag(CACHE_TAGS.VACATION_POLICY(organizationId), "max");
		}),
);

export type EmployeeAdjustmentSummary = VacationAdjustmentSums & {
	/** Manual adjustments only, newest first; accrual rows are summed in `accrual` (#1106). */
	manualAdjustments: Array<Omit<ManualVacationAdjustment, "createdAt"> & { createdAt: string }>;
};

/**
 * An employee's vacation adjustments for a year: the manual and accrual sums every balance
 * reader adds (#1105, #1106) and the history of manual adjustments.
 */
export const getEmployeeAdjustmentSummary = organizationAction(
	{
		name: "vacation.employeeAdjustmentSummary",
		requires: "scopedManager",
		schema: employeeYearSchema,
	},
	({ actor, organizationId, input: { employeeId, year } }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, "vacation_adjustment", "read");
			const dbService = yield* DatabaseService;

			const scope = { organizationId, employeeId, year };
			return yield* dbService.query(
				"getEmployeeAdjustmentSummary",
				async (): Promise<EmployeeAdjustmentSummary> => {
					const [sums, manualAdjustments] = await Promise.all([
						loadVacationAdjustmentSums(dbService.db, { ...scope, employeeIds: [employeeId] }),
						loadManualVacationAdjustments(dbService.db, scope),
					]);
					return {
						...(sums.get(employeeId) ?? { manual: 0, accrual: 0 }),
						manualAdjustments: manualAdjustments.map((adjustment) => ({
							...adjustment,
							createdAt: adjustment.createdAt.toISOString(),
						})),
					};
				},
			);
		}),
);

export type EmployeeVacationBalanceView = {
	/** Organization calendar zone for reviewing the stored carryover expiry. */
	timezone: string;
	/** The organization's current calendar year, the year the admin page edits. */
	year: number;
	/** Null when policy periods cannot produce a reliable balance. */
	balance: VacationBalance | null;
	configuration: VacationBalanceConfiguration | null;
	policy: { name: string; defaultAnnualDays: string } | null;
	/** The policy grants its allowance monthly or biweekly through accrual (#1106). */
	accrualPolicy: boolean;
};

/**
 * An employee's vacation balance for the organization's current year, for the admin vacation
 * page (#1111): the same server-side balance as the employee's Absences page, with the prorated
 * allowance's explanation and overdrawn vacation. Admins see any employee of the organization,
 * managers only the employees they manage.
 */
export const getEmployeeVacationBalance = organizationAction(
	{ name: "vacation.employeeBalance", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(actor, organizationId, employeeId, "employee_allowance", "read");
			const dbService = yield* DatabaseService;

			return yield* dbService.query(
				"getEmployeeVacationBalance",
				async (): Promise<EmployeeVacationBalanceView> => {
					const timezone = await loadOrganizationTimezone(dbService.db, organizationId);
					const year = calendarYearAt(systemClock.nowInstant(), timezone);
					const { policies, balances, configurations } = await loadVacationBalances(dbService.db, {
						organizationId,
						employeeIds: [employeeId],
						year,
						timezone,
					});
					const policy = policies.get(employeeId);
					return {
						timezone,
						year,
						balance: balances.get(employeeId) ?? null,
						configuration: configurations.get(employeeId) ?? null,
						policy: policy
							? { name: policy.name, defaultAnnualDays: policy.defaultAnnualDays }
							: null,
						accrualPolicy: policy ? isAccrualPolicy(policy) : false,
					};
				},
			);
		}),
);
