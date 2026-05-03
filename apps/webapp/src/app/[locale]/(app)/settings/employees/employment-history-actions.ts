import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	type EmployeeEmploymentHistory,
	employee,
	employeeEmploymentHistory,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { adjustConfirmedTimeline, type TimelineUpdate } from "@/lib/employment-history/timeline";
import { createLogger } from "@/lib/logger";
import {
	type UpsertEmploymentHistory,
	upsertEmploymentHistorySchema,
} from "@/lib/validations/employment-history";
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

export function buildEmploymentAssignmentSyncPlan(
	row: EmploymentHistoryAssignmentRow,
	legalEntityId: string,
) {
	if (row.reviewState !== "confirmed" || !row.workPolicyId) {
		return null;
	}

	return {
		policyId: row.workPolicyId,
		organizationId: row.organizationId,
		legalEntityId,
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

export async function listEmployeeEmploymentHistoryAction(
	employeeId: string,
): Promise<ServerActionResult<EmployeeEmploymentHistory[]>> {
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

				span.setAttribute("history.count", history.length);
				return history;
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

							const existing = await tx.query.employeeEmploymentHistory.findMany({
								where: and(
									eq(employeeEmploymentHistory.employeeId, employeeId),
									eq(employeeEmploymentHistory.organizationId, actor.organizationId),
								),
							});
							const now = currentTimestamp();
							const nextRow: EmployeeEmploymentHistory = {
								id: randomUUID(),
								employeeId,
								organizationId: actor.organizationId,
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
							const assignmentWindowUpdates = buildEmploymentAssignmentWindowUpdates({
								updates: adjusted.updates,
								existing,
							});

							for (const update of adjusted.updates) {
								await tx
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
									);
							}

							for (const update of assignmentWindowUpdates) {
								await tx
									.update(workPolicyAssignment)
									.set({
										effectiveUntil: update.effectiveUntil,
										updatedAt: now,
									})
									.where(
										and(
											eq(workPolicyAssignment.employeeId, update.employeeId),
											eq(workPolicyAssignment.organizationId, update.organizationId),
											eq(workPolicyAssignment.policyId, update.workPolicyId),
											eq(workPolicyAssignment.assignmentType, "employee"),
											eq(workPolicyAssignment.isActive, true),
											eq(workPolicyAssignment.effectiveFrom, update.effectiveFrom),
										),
									);
							}

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

							const assignmentPlan = buildEmploymentAssignmentSyncPlan(
								inserted,
								targetEmployee.legalEntityId,
							);
							if (assignmentPlan) {
								await tx.insert(workPolicyAssignment).values({
									...assignmentPlan,
									createdBy: session.user.id,
									createdAt: now,
									updatedAt: now,
								});
							}

							return inserted;
						});
					}),
				);

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

							const now = currentTimestamp();
							const adjusted = adjustConfirmedTimeline({
								existing,
								next: { ...targetHistory, reviewState: "confirmed" as const },
							});
							const assignmentWindowUpdates = buildEmploymentAssignmentWindowUpdates({
								updates: adjusted.updates,
								existing,
							});

							for (const update of adjusted.updates) {
								await tx
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
									);
							}

							for (const update of assignmentWindowUpdates) {
								await tx
									.update(workPolicyAssignment)
									.set({
										effectiveUntil: update.effectiveUntil,
										updatedAt: now,
									})
									.where(
										and(
											eq(workPolicyAssignment.employeeId, update.employeeId),
											eq(workPolicyAssignment.organizationId, update.organizationId),
											eq(workPolicyAssignment.policyId, update.workPolicyId),
											eq(workPolicyAssignment.assignmentType, "employee"),
											eq(workPolicyAssignment.isActive, true),
											eq(workPolicyAssignment.effectiveFrom, update.effectiveFrom),
										),
									);
							}

							const [updated] = await tx
								.update(employeeEmploymentHistory)
								.set({
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

							const assignmentPlan = buildEmploymentAssignmentSyncPlan(
								updated,
								targetEmployee.legalEntityId,
							);
							if (assignmentPlan) {
								await tx.insert(workPolicyAssignment).values({
									...assignmentPlan,
									createdBy: session.user.id,
									createdAt: now,
									updatedAt: now,
								});
							}

							return updated;
						});
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

				yield* _(
					dbService.query("cancelEmployeeEmploymentHistory", async () => {
						await dbService.db.transaction(async (tx) => {
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
							const restorationPlan = buildEmploymentCancellationRestorationPlan({
								canceled: targetHistory,
								existing,
							});

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

								if (restorationPlan.assignmentWindowUpdate) {
									await tx
										.update(workPolicyAssignment)
										.set({
											effectiveUntil: restorationPlan.assignmentWindowUpdate.effectiveUntil,
											updatedAt: now,
										})
										.where(
											and(
												eq(
													workPolicyAssignment.employeeId,
													restorationPlan.assignmentWindowUpdate.employeeId,
												),
												eq(
													workPolicyAssignment.organizationId,
													restorationPlan.assignmentWindowUpdate.organizationId,
												),
												eq(
													workPolicyAssignment.policyId,
													restorationPlan.assignmentWindowUpdate.workPolicyId,
												),
												eq(workPolicyAssignment.assignmentType, "employee"),
												eq(workPolicyAssignment.isActive, true),
												eq(
													workPolicyAssignment.effectiveFrom,
													restorationPlan.assignmentWindowUpdate.effectiveFrom,
												),
											),
										);
								}
							}

							if (targetHistory.reviewState === "confirmed" && targetHistory.workPolicyId) {
								await tx
									.delete(workPolicyAssignment)
									.where(
										and(
											eq(workPolicyAssignment.employeeId, targetHistory.employeeId),
											eq(workPolicyAssignment.organizationId, targetHistory.organizationId),
											eq(workPolicyAssignment.policyId, targetHistory.workPolicyId),
											eq(workPolicyAssignment.assignmentType, "employee"),
											eq(workPolicyAssignment.isActive, true),
											eq(workPolicyAssignment.effectiveFrom, targetHistory.validFrom),
										),
									);
							}
						});
					}),
				);

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
