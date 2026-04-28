import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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
import { NotFoundError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { adjustConfirmedTimeline } from "@/lib/employment-history/timeline";
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

type EmploymentHistoryAssignmentRow = Pick<
	EmployeeEmploymentHistory,
	"employeeId" | "organizationId" | "workPolicyId" | "validFrom" | "validUntil" | "reviewState"
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

							const assignmentPlan = buildEmploymentAssignmentSyncPlan(inserted);
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
