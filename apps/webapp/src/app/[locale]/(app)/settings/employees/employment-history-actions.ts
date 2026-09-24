import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	type EmployeeEmploymentHistory,
	employee,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
	workPolicy,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	EmploymentPeriodError,
	resolveTermsEmploymentPeriod,
} from "@/lib/employee-lifecycle/employment-periods";
import type { LifecycleTransaction } from "@/lib/employee-lifecycle/types";
import { adjustConfirmedTimeline, type TimelineUpdate } from "@/lib/employment-history/timeline";
import { createLogger } from "@/lib/logger";
import {
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

type EmploymentHistoryEffectiveRow = Pick<
	EmployeeEmploymentHistory,
	"reviewState" | "validFrom" | "validUntil"
>;

type EmploymentHistoryReviewRow = Pick<EmployeeEmploymentHistory, "reviewState">;

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

export function shouldUpdateCurrentEmployeeFields(
	row: EmploymentHistoryEffectiveRow,
	now = DateTime.utc().toJSDate(),
) {
	if (row.reviewState !== "confirmed") {
		return false;
	}

	const current = DateTime.fromJSDate(now).toUTC();
	const validFrom = DateTime.fromJSDate(row.validFrom).toUTC();
	const validUntil = row.validUntil ? DateTime.fromJSDate(row.validUntil).toUTC() : null;

	return validFrom <= current && (!validUntil || validUntil > current);
}

export function shouldConfirmEmploymentHistoryRow(row: EmploymentHistoryReviewRow) {
	return row.reviewState === "draft" || row.reviewState === "pending";
}

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
 * Terms belong to the employee's open employment period. An ended period is
 * never reopened by terms; only an explicit rehire starts a new one.
 */
async function requireTermsEmploymentPeriod(
	tx: LifecycleTransaction,
	input: { organizationId: string; employeeId: string; validFrom: Date },
) {
	try {
		return await resolveTermsEmploymentPeriod(tx, input);
	} catch (error) {
		if (error instanceof EmploymentPeriodError) {
			throw new ValidationError({
				message:
					error.code === "employment_period_closed"
						? "This employee's employment has ended. Rehire them before adding employment terms."
						: "Employment terms cannot start before the current employment period.",
				field: "validFrom",
			});
		}
		throw error;
	}
}

async function markContractWorkBalanceDirty(input: {
	employeeId: string;
	organizationId: string;
	fromDate: Date;
}) {
	const dirtyFromDate = DateTime.fromJSDate(input.fromDate, { zone: "utc" }).toISODate();
	if (!dirtyFromDate) return;

	try {
		await markEmployeeWorkBalanceDirty({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dirtyFromDate,
		});
	} catch (error) {
		logger.error(
			{ error, ...input, dirtyFromDate },
			"Failed to mark work balance dirty after contract change",
		);
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
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { dbService } = actor;
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee's employment history",
						resource: "employment_history",
						action: "read",
					}),
				);

				const history = yield* _(
					dbService.query("listEmployeeEmploymentHistory", async () => {
						return await dbService.db.query.employeeEmploymentHistory.findMany({
							where: and(
								eq(employeeEmploymentHistory.employeeId, employeeId),
								eq(employeeEmploymentHistory.organizationId, actor.organizationId),
							),
							orderBy: [desc(employeeEmploymentHistory.validFrom)],
						});
					}),
				);

				const periods = yield* _(
					dbService.query("listEmployeeEmploymentPeriods", async () => {
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
					}),
				);
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
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { dbService, session } = actor;

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can create employment history",
						resource: "employment_history",
						action: "create",
					}),
				);

				const validatedData = yield* _(validateInput(upsertEmploymentHistorySchema, data));
				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee's employment history",
						resource: "employment_history",
						action: "create",
					}),
				);

				if (validatedData.workPolicyId) {
					const policy = yield* _(
						dbService.query("getEmploymentHistoryWorkPolicy", async () => {
							return await dbService.db.query.workPolicy.findFirst({
								where: and(
									eq(workPolicy.id, validatedData.workPolicyId!),
									eq(workPolicy.organizationId, actor.organizationId),
								),
							});
						}),
					);

					if (!policy) {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Work policy not found",
									entityType: "work_policy",
									entityId: validatedData.workPolicyId,
								}),
							),
						);
					}
				}

				const createdHistory = yield* _(
					dbService.query("createEmployeeEmploymentHistory", async () => {
						return await dbService.db.transaction(async (tx) => {
							await tx.execute(sql`
								select ${employee.id}
								from ${employee}
								where ${employee.id} = ${employeeId}
									and ${employee.organizationId} = ${actor.organizationId}
								for update
							`);

							const employmentPeriodId = await requireTermsEmploymentPeriod(tx, {
								organizationId: actor.organizationId,
								employeeId,
								validFrom: validatedData.validFrom,
							});
							// The timeline never joins terms across employment periods.
							const existing = await tx.query.employeeEmploymentHistory.findMany({
								where: and(
									eq(employeeEmploymentHistory.employeeId, employeeId),
									eq(employeeEmploymentHistory.organizationId, actor.organizationId),
									eq(employeeEmploymentHistory.employmentPeriodId, employmentPeriodId),
								),
							});
							const now = currentTimestamp();
							const nextRow: EmployeeEmploymentHistory = {
								id: randomUUID(),
								employeeId,
								organizationId: actor.organizationId,
								employmentPeriodId,
								validFrom: validatedData.validFrom,
								validUntil: null,
								status: validatedData.status,
								contractType: validatedData.contractType,
								weeklyContractMinutes: validatedData.weeklyContractMinutes,
								probationStartsOn: validatedData.probationStartsOn ?? null,
								probationEndsOn: validatedData.probationEndsOn ?? null,
								workModel: validatedData.workModel,
								workPolicyId: validatedData.workPolicyId ?? null,
								hourlyRate: validatedData.hourlyRate ?? null,
								currency: validatedData.currency,
								changeReason: validatedData.changeReason ?? null,
								reviewState: validatedData.reviewState,
								createdBy: session.user.id,
								createdAt: now,
								updatedBy: session.user.id,
								updatedAt: now,
							};
							const adjusted = adjustConfirmedTimeline({ existing, next: nextRow });
							await Promise.all(
								adjusted.updates.map((update) =>
									tx
										.update(employeeEmploymentHistory)
										.set({
											validUntil: update.validUntil,
											updatedBy: session.user.id,
											updatedAt: now,
										})
										.where(
											and(
												eq(employeeEmploymentHistory.id, update.id),
												eq(employeeEmploymentHistory.employeeId, employeeId),
												eq(employeeEmploymentHistory.organizationId, actor.organizationId),
											),
										),
								),
							);

							const [inserted] = await tx
								.insert(employeeEmploymentHistory)
								.values(adjusted.next)
								.returning();

							if (!inserted) {
								throw new Error("Employment history insert returned no row");
							}

							if (shouldUpdateCurrentEmployeeFields(inserted, now)) {
								await tx
									.update(employee)
									.set({
										contractType: inserted.contractType,
										currentHourlyRate: inserted.hourlyRate,
										updatedAt: now,
									})
									.where(
										and(
											eq(employee.id, employeeId),
											eq(employee.organizationId, actor.organizationId),
										),
									);
							}

							return inserted;
						});
					}),
				);

				if (createdHistory.reviewState === "confirmed") {
					yield* _(
						Effect.promise(() =>
							markContractWorkBalanceDirty({
								employeeId,
								organizationId: actor.organizationId,
								fromDate: createdHistory.validFrom,
							}),
						),
					);
				}

				revalidateEmployeesCache(actor.organizationId);

				return createdHistory;
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
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { dbService, session } = actor;

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can confirm employment history",
						resource: "employment_history",
						action: "confirm",
					}),
				);

				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee's employment history",
						resource: "employment_history",
						action: "confirm",
					}),
				);

				const confirmedHistory = yield* _(
					dbService.query("confirmEmployeeEmploymentHistory", async () => {
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

							if (!shouldConfirmEmploymentHistoryRow(targetHistory)) {
								throw new ValidationError({
									message: "Employment history is already confirmed",
									field: "reviewState",
								});
							}

							const employmentPeriodId = await requireTermsEmploymentPeriod(tx, {
								organizationId: actor.organizationId,
								employeeId,
								validFrom: targetHistory.validFrom,
							});
							if (
								targetHistory.employmentPeriodId &&
								targetHistory.employmentPeriodId !== employmentPeriodId
							) {
								throw new ValidationError({
									message:
										"These terms belong to an ended employment period and can no longer be confirmed.",
									field: "reviewState",
								});
							}

							const now = currentTimestamp();
							const adjusted = adjustConfirmedTimeline({
								existing: existing.filter((row) => row.employmentPeriodId === employmentPeriodId),
								next: { ...targetHistory, employmentPeriodId, reviewState: "confirmed" as const },
							});
							await Promise.all(
								adjusted.updates.map((update) =>
									tx
										.update(employeeEmploymentHistory)
										.set({
											validUntil: update.validUntil,
											updatedBy: session.user.id,
											updatedAt: now,
										})
										.where(
											and(
												eq(employeeEmploymentHistory.id, update.id),
												eq(employeeEmploymentHistory.employeeId, employeeId),
												eq(employeeEmploymentHistory.organizationId, actor.organizationId),
											),
										),
								),
							);

							const [updated] = await tx
								.update(employeeEmploymentHistory)
								.set({
									employmentPeriodId,
									validUntil: adjusted.next.validUntil,
									reviewState: "confirmed",
									updatedBy: session.user.id,
									updatedAt: now,
								})
								.where(
									and(
										eq(employeeEmploymentHistory.id, historyId),
										eq(employeeEmploymentHistory.employeeId, employeeId),
										eq(employeeEmploymentHistory.organizationId, actor.organizationId),
									),
								)
								.returning();

							if (!updated) {
								throw new Error("Employment history update returned no row");
							}

							if (shouldUpdateCurrentEmployeeFields(updated, now)) {
								await tx
									.update(employee)
									.set({
										contractType: updated.contractType,
										currentHourlyRate: updated.hourlyRate,
										updatedAt: now,
									})
									.where(
										and(
											eq(employee.id, employeeId),
											eq(employee.organizationId, actor.organizationId),
										),
									);
							}

							return updated;
						});
					}),
				);

				yield* _(
					Effect.promise(() =>
						markContractWorkBalanceDirty({
							employeeId,
							organizationId: actor.organizationId,
							fromDate: confirmedHistory.validFrom,
						}),
					),
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
			Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const { dbService, session } = actor;

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only organization admins can cancel employment history",
						resource: "employment_history",
						action: "cancel",
					}),
				);

				const targetEmployee = yield* _(getTargetEmployee(employeeId));

				yield* _(
					ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
						message: "You do not have access to this employee's employment history",
						resource: "employment_history",
						action: "cancel",
					}),
				);

				const canceledHistory = yield* _(
					dbService.query("cancelEmployeeEmploymentHistory", async () => {
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
					}),
				);

				if (canceledHistory.reviewState === "confirmed") {
					yield* _(
						Effect.promise(() =>
							markContractWorkBalanceDirty({
								employeeId,
								organizationId: actor.organizationId,
								fromDate: canceledHistory.validFrom,
							}),
						),
					);
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
