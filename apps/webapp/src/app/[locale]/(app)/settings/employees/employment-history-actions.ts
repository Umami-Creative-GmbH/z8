import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	type EmployeeEmploymentHistory,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";
import type { TimelineUpdate } from "@/lib/employment-history/timeline";
import {
	changeHourlyWage,
	confirmEmploymentTerms,
	writeEmploymentTerms,
} from "@/lib/employment-history/write-terms";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	type ChangeHourlyWage,
	changeHourlyWageSchema,
	type UpsertEmploymentHistory,
	upsertEmploymentHistorySchema,
} from "@/lib/validations/employment-history";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

const logger = createLogger("EmploymentHistoryActions");

type EmploymentHistoryCancelableRow = Pick<EmployeeEmploymentHistory, "reviewState" | "validFrom">;

type EmploymentHistoryAssignmentRow = Pick<
	EmployeeEmploymentHistory,
	"employeeId" | "organizationId" | "workPolicyId" | "validFrom" | "validUntil" | "reviewState"
>;

type EmploymentHistoryAssignmentWindowRow = Pick<
	EmployeeEmploymentHistory,
	"id" | "employeeId" | "organizationId" | "workPolicyId" | "validFrom" | "validUntil"
>;

type EmploymentHistoryCancellationRestorationRow = Pick<
	EmployeeEmploymentHistory,
	| "id"
	| "employeeId"
	| "organizationId"
	| "workPolicyId"
	| "validFrom"
	| "validUntil"
	| "reviewState"
>;

export function canCancelEmploymentHistoryRow(
	row: EmploymentHistoryCancelableRow,
	now = DateTime.utc().toJSDate(),
) {
	if (row.reviewState === "draft" || row.reviewState === "pending") {
		return true;
	}

	return DateTime.fromJSDate(row.validFrom).toUTC() > DateTime.fromJSDate(now).toUTC();
}

export function buildEmploymentAssignmentSyncPlan(row: EmploymentHistoryAssignmentRow) {
	if (row.reviewState !== "confirmed" || !row.workPolicyId) {
		return null;
	}

	return {
		policyId: row.workPolicyId,
		organizationId: row.organizationId,
		assignmentType: "employee" as const,
		employeeId: row.employeeId,
		teamId: null,
		priority: 2,
		effectiveFrom: row.validFrom,
		effectiveUntil: row.validUntil,
		isActive: true,
	};
}

export function buildEmploymentAssignmentWindowUpdates({
	updates,
	existing,
}: {
	updates: TimelineUpdate[];
	existing: EmploymentHistoryAssignmentWindowRow[];
}) {
	return updates.flatMap((update) => {
		const historyRow = existing.find((row) => row.id === update.id);
		if (!historyRow?.workPolicyId) {
			return [];
		}

		return [
			{
				employeeId: historyRow.employeeId,
				organizationId: historyRow.organizationId,
				workPolicyId: historyRow.workPolicyId,
				effectiveFrom: historyRow.validFrom,
				effectiveUntil: update.validUntil,
			},
		];
	});
}

export function buildEmploymentCancellationRestorationPlan({
	canceled,
	existing,
}: {
	canceled: EmploymentHistoryCancellationRestorationRow;
	existing: EmploymentHistoryCancellationRestorationRow[];
}) {
	if (canceled.reviewState !== "confirmed") {
		return null;
	}

	const confirmed = existing
		.filter((row) => row.reviewState === "confirmed" && row.id !== canceled.id)
		.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
	const previous = confirmed
		.filter((row) => row.validFrom.getTime() < canceled.validFrom.getTime())
		.at(-1);

	if (!previous) {
		return null;
	}

	const next = confirmed.find((row) => row.validFrom.getTime() > canceled.validFrom.getTime());
	const validUntil = next ? next.validFrom : null;

	return {
		historyUpdate: {
			id: previous.id,
			validUntil,
		},
		assignmentWindowUpdate: previous.workPolicyId
			? {
					employeeId: previous.employeeId,
					organizationId: previous.organizationId,
					workPolicyId: previous.workPolicyId,
					effectiveFrom: previous.validFrom,
					effectiveUntil: validUntil,
				}
			: null,
	};
}

/**
 * The wage command throws its refusals inside the query; keep their type so
 * users see the refusal, not "Database query failed" (D8).
 */
export function keepTermsRefusal(error: DatabaseError) {
	return error.cause instanceof ValidationError || error.cause instanceof NotFoundError
		? error.cause
		: error;
}

/**
 * Confirmed terms change the contract the work balance counts from: marks it
 * dirty from the terms' first calendar date (D1). Runs after the commit and
 * never throws.
 */
export async function markContractWorkBalanceDirty(
	reader: Parameters<typeof loadOrganizationTimezone>[0],
	input: { employeeId: string; organizationId: string; validFrom: Date },
) {
	try {
		const timezone = await loadOrganizationTimezone(reader, input.organizationId);
		const dirtyFromDate = termsCalendarDate(input.validFrom, timezone).toString();
		await markEmployeeWorkBalanceDirty({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dirtyFromDate,
		});
	} catch (error) {
		logger.error({ error, ...input }, "Failed to mark work balance dirty after contract change");
	}
}

/** Terms with the employment stint they belong to, for grouping by stint. */
export type EmployeeEmploymentHistoryWithPeriod = EmployeeEmploymentHistory & {
	employmentPeriod: {
		id: string;
		status: "open" | "closed" | "legacy_unknown";
		startedAt: Date | null;
		endedAt: Date | null;
	} | null;
};

export async function listEmployeeEmploymentHistoryAction(
	employeeId: string,
): Promise<ServerActionResult<EmployeeEmploymentHistoryWithPeriod[]>> {
	"use server";

	return runTracedEmployeeAction({
		name: "listEmployeeEmploymentHistory",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to list employment history");
		},
		execute: (span) =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "listEmployeeEmploymentHistoryAction:actor" });
				const { dbService } = actor;
				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "read",
				});

				const history = yield* dbService.query("listEmployeeEmploymentHistory", async () => {
					return await dbService.db.query.employeeEmploymentHistory.findMany({
						where: and(
							eq(employeeEmploymentHistory.employeeId, employeeId),
							eq(employeeEmploymentHistory.organizationId, actor.organizationId),
						),
						orderBy: [desc(employeeEmploymentHistory.validFrom)],
					});
				});

				const periods = yield* dbService.query("listEmployeeEmploymentPeriods", async () => {
					return await dbService.db
						.select({
							id: employeeEmploymentPeriod.id,
							status: employeeEmploymentPeriod.status,
							startedAt: employeeEmploymentPeriod.startedAt,
							endedAt: employeeEmploymentPeriod.endedAt,
						})
						.from(employeeEmploymentPeriod)
						.where(
							and(
								eq(employeeEmploymentPeriod.employeeId, employeeId),
								eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
							),
						);
				});
				const periodById = new Map(periods.map((period) => [period.id, period]));

				span.setAttribute("history.count", history.length);
				return history.map((entry) => ({
					...entry,
					employmentPeriod: entry.employmentPeriodId
						? (periodById.get(entry.employmentPeriodId) ?? null)
						: null,
				}));
			}),
	});
}

export async function createEmployeeEmploymentHistoryAction(
	employeeId: string,
	data: UpsertEmploymentHistory,
): Promise<ServerActionResult<EmployeeEmploymentHistory>> {
	"use server";

	return runTracedEmployeeAction({
		name: "createEmployeeEmploymentHistory",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to create employment history");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "createEmployeeEmploymentHistoryAction:actor" });
				const { dbService, session } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can create employment history",
					resource: "employment_history",
					action: "create",
				});

				const validatedData = yield* validateInput(upsertEmploymentHistorySchema, data);
				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "create",
				});

				const createdHistory = yield* dbService
					.query("createEmployeeEmploymentHistory", () =>
						dbService.db.transaction((tx) =>
							writeEmploymentTerms(tx, {
								organizationId: actor.organizationId,
								employeeId,
								actorUserId: session.user.id,
								terms: validatedData,
							}),
						),
					)
					.pipe(Effect.mapError(keepTermsRefusal));

				if (createdHistory.reviewState === "confirmed") {
					yield* Effect.promise(() =>
						markContractWorkBalanceDirty(dbService.db, {
							employeeId,
							organizationId: actor.organizationId,
							validFrom: createdHistory.validFrom,
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);

				return createdHistory;
			}),
	});
}

/**
 * "Change wage" on the Contract & Work Model card: new terms from a date that
 * copy the hourly terms in force then, with a new wage. Org admins only.
 */
export async function changeEmployeeWageAction(
	employeeId: string,
	data: ChangeHourlyWage,
): Promise<ServerActionResult<EmployeeEmploymentHistory>> {
	"use server";

	return runTracedEmployeeAction({
		name: "changeEmployeeWage",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to change employee wage");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "employmentTerms.changeWageActor" });
				const { dbService, session } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can change wages",
					resource: "employment_history",
					action: "change_wage",
				});

				const validatedData = yield* validateInput(changeHourlyWageSchema, data);
				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "change_wage",
				});

				const written = yield* dbService
					.query("employmentTerms.changeWage", () =>
						dbService.db.transaction((tx) =>
							changeHourlyWage(tx, {
								organizationId: actor.organizationId,
								employeeId,
								actorUserId: session.user.id,
								effectiveOn: parsePlainDate(validatedData.effectiveOn),
								hourlyRate: validatedData.hourlyRate,
								changeReason: validatedData.changeReason,
								reviewState: validatedData.reviewState,
							}),
						),
					)
					.pipe(Effect.mapError(keepTermsRefusal));

				if (written.reviewState === "confirmed") {
					yield* Effect.promise(() =>
						markContractWorkBalanceDirty(dbService.db, {
							employeeId,
							organizationId: actor.organizationId,
							validFrom: written.validFrom,
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);

				return written;
			}),
	});
}

export async function confirmEmployeeEmploymentHistoryAction(
	employeeId: string,
	historyId: string,
): Promise<ServerActionResult<EmployeeEmploymentHistory>> {
	"use server";

	return runTracedEmployeeAction({
		name: "confirmEmployeeEmploymentHistory",
		attributes: {
			"employee.id": employeeId,
			"employment_history.id": historyId,
		},
		logError: (error) => {
			logger.error({ error, employeeId, historyId }, "Failed to confirm employment history");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "confirmEmployeeEmploymentHistoryAction:actor" });
				const { dbService, session } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can confirm employment history",
					resource: "employment_history",
					action: "confirm",
				});

				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "confirm",
				});

				const confirmedHistory = yield* dbService
					.query("confirmEmployeeEmploymentHistory", () =>
						dbService.db.transaction((tx) =>
							confirmEmploymentTerms(tx, {
								organizationId: actor.organizationId,
								employeeId,
								actorUserId: session.user.id,
								termsId: historyId,
							}),
						),
					)
					.pipe(Effect.mapError(keepTermsRefusal));

				yield* Effect.promise(() =>
					markContractWorkBalanceDirty(dbService.db, {
						employeeId,
						organizationId: actor.organizationId,
						validFrom: confirmedHistory.validFrom,
					}),
				);

				revalidateEmployeesCache(actor.organizationId);

				return confirmedHistory;
			}),
	});
}

export async function cancelEmployeeEmploymentHistoryAction(
	employeeId: string,
	historyId: string,
): Promise<ServerActionResult<void>> {
	"use server";

	return runTracedEmployeeAction({
		name: "cancelEmployeeEmploymentHistory",
		attributes: {
			"employee.id": employeeId,
			"employment_history.id": historyId,
		},
		logError: (error) => {
			logger.error({ error, employeeId, historyId }, "Failed to cancel employment history");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "cancelEmployeeEmploymentHistoryAction:actor" });
				const { dbService, session } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can cancel employment history",
					resource: "employment_history",
					action: "cancel",
				});

				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee's employment history",
					resource: "employment_history",
					action: "cancel",
				});

				const canceledHistory = yield* dbService.query(
					"cancelEmployeeEmploymentHistory",
					async () => {
						return await dbService.db.transaction(async (tx) => {
							await tx.execute(sql`
								select ${employee.id}
								from ${employee}
								where ${employee.id} = ${employeeId}
									and ${employee.organizationId} = ${actor.organizationId}
								for update
							`);

							const existing = await tx.query.employeeEmploymentHistory.findMany({
								where: and(
									eq(employeeEmploymentHistory.employeeId, employeeId),
									eq(employeeEmploymentHistory.organizationId, actor.organizationId),
								),
							});
							const targetHistory = existing.find((row) => row.id === historyId);

							if (!targetHistory) {
								throw new NotFoundError({
									message: "Employment history not found",
									entityType: "employment_history",
									entityId: historyId,
								});
							}

							if (!canCancelEmploymentHistoryRow(targetHistory)) {
								throw new ValidationError({
									message: "Employment history has already taken effect",
									field: "validFrom",
								});
							}

							const now = currentTimestamp();
							// Restoration only extends terms inside the same open period; after
							// a departure the previous terms already end at the cutoff.
							const periodStatus = targetHistory.employmentPeriodId
								? await tx.execute<{ status: string }>(sql`
										select status from employee_employment_period
										where id = ${targetHistory.employmentPeriodId}
											and organization_id = ${actor.organizationId}
									`)
								: null;
							const periodIsOpen = periodStatus ? periodStatus.rows[0]?.status === "open" : true;
							const restorationPlan = periodIsOpen
								? buildEmploymentCancellationRestorationPlan({
										canceled: targetHistory,
										existing: existing.filter(
											(row) => row.employmentPeriodId === targetHistory.employmentPeriodId,
										),
									})
								: null;

							await tx
								.delete(employeeEmploymentHistory)
								.where(
									and(
										eq(employeeEmploymentHistory.id, historyId),
										eq(employeeEmploymentHistory.employeeId, employeeId),
										eq(employeeEmploymentHistory.organizationId, actor.organizationId),
									),
								);

							if (restorationPlan) {
								await tx
									.update(employeeEmploymentHistory)
									.set({
										validUntil: restorationPlan.historyUpdate.validUntil,
										updatedBy: session.user.id,
										updatedAt: now,
									})
									.where(
										and(
											eq(employeeEmploymentHistory.id, restorationPlan.historyUpdate.id),
											eq(employeeEmploymentHistory.employeeId, employeeId),
											eq(employeeEmploymentHistory.organizationId, actor.organizationId),
										),
									);
							}

							return targetHistory;
						});
					},
				);

				if (canceledHistory.reviewState === "confirmed") {
					yield* Effect.promise(() =>
						markContractWorkBalanceDirty(dbService.db, {
							employeeId,
							organizationId: actor.organizationId,
							validFrom: canceledHistory.validFrom,
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
