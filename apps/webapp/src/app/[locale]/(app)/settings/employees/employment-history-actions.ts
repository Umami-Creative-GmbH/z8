import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	type EmployeeEmploymentHistory,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
} from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { type DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";
import {
	cancelEmploymentTerms,
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
				const targetEmployee = yield* getTargetEmployee(employeeId, "getTargetEmployee", actor.organizationId);

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

				const canceledHistory = yield* dbService
					.query("cancelEmployeeEmploymentHistory", () =>
						dbService.db.transaction((tx) =>
							cancelEmploymentTerms(tx, {
								organizationId: actor.organizationId,
								employeeId,
								actorUserId: session.user.id,
								termsId: historyId,
							}),
						),
					)
					.pipe(Effect.mapError(keepTermsRefusal));

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
