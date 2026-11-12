"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { AuditTrail } from "@/lib/audit-trail";
import { auth, runAuthMutation } from "@/lib/auth";
import { completeRemovedMemberCleanup } from "@/lib/auth/member-removal-cleanup";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { deactivate } from "@/lib/employee-lifecycle/deactivation/command";
import { previewEmployeeDeactivation } from "@/lib/employee-lifecycle/deactivation/preview";
import {
	checkLifecycleTarget,
	type LifecycleTargetCheck,
	type LifecycleTargetEmployee,
} from "@/lib/employee-lifecycle/lifecycle-target";
import { tryLockLifecycleOrganization } from "@/lib/employee-lifecycle/locks";
import { executeReactivation } from "@/lib/employee-lifecycle/reactivation";
import { DeactivationRequestConflictError } from "@/lib/employee-lifecycle/receipts";
import { createLogger } from "@/lib/logger";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { pauseSchedulesAfterOwnerAccessChange } from "@/lib/scheduled-exports/application/owner-access-change";
import { revalidateEmployeesCache } from "./employee-action-utils";

const logger = createLogger("EmployeeLifecycleActions");
const employeeIdSchema = z.uuid("Invalid employee ID");
const replacementManagersSchema = z
	.record(z.uuid("Invalid employee ID"), z.uuid("Invalid employee ID"))
	.refine((picks) => Object.keys(picks).length <= 500, "Too many replacement managers")
	.default({});
const deactivateEmployeeSchema = z.strictObject({
	employeeId: employeeIdSchema,
	requestId: z.uuid("Invalid request ID"),
	replacementManagers: replacementManagersSchema,
});
const previewEmployeeDeactivationSchema = z.strictObject({
	employeeId: employeeIdSchema,
	replacementManagers: replacementManagersSchema,
});

export type DeactivateEmployeeInput = z.input<typeof deactivateEmployeeSchema>;
export type PreviewEmployeeDeactivationInput = z.input<typeof previewEmployeeDeactivationSchema>;

const ownerInvariantViolationMessage = "Organization must retain an approved accessible owner";
const finalOwnerDeactivateGuidance =
	"Assign and activate another approved owner before deactivating this employee";
const removeFinalOwnerGuidance =
	"Assign and activate another approved owner before removing this employee's access";
const requestConflictMessage =
	"This deactivation was already submitted with different choices. Review the preview and try again.";

type LifecycleRefusal = Exclude<LifecycleTargetCheck, { type: "change" } | { type: "unchanged" }>;

type ReactivationTransactionResult =
	| {
			type: "success";
			changed: boolean;
			targetEmployee: LifecycleTargetEmployee;
			/** The closed deactivation follow-up, forwarded after the commit. */
			audit?: AuditTrail;
	  }
	| LifecycleRefusal;

function isOwnerInvariantViolation(error: DatabaseError) {
	let cause: unknown = error.cause;

	for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth += 1) {
		const candidate = cause as {
			code?: unknown;
			message?: unknown;
			cause?: unknown;
		};
		if (
			candidate.code === "23514" &&
			typeof candidate.message === "string" &&
			candidate.message.includes(ownerInvariantViolationMessage)
		) {
			return true;
		}
		cause = candidate.cause;
	}

	return false;
}

function isRequestConflict(error: DatabaseError) {
	let cause: unknown = error.cause;
	for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth += 1) {
		if (cause instanceof DeactivationRequestConflictError) return true;
		cause = (cause as { cause?: unknown }).cause;
	}
	return false;
}

function isFinalOwnerRemovalError(error: unknown) {
	const candidates: unknown[] = [error];
	const seen = new Set<object>();

	for (let index = 0; index < candidates.length && index < 20; index += 1) {
		const candidate = candidates[index];
		if (typeof candidate === "string") {
			const normalized = candidate.toLowerCase().replaceAll("_", " ");
			if (normalized.includes("last owner") || normalized.includes("approved accessible owner")) {
				return true;
			}
			continue;
		}

		if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		const errorRecord = candidate as {
			body?: unknown;
			cause?: unknown;
			code?: unknown;
			message?: unknown;
		};
		candidates.push(errorRecord.code, errorRecord.message, errorRecord.body, errorRecord.cause);
	}

	return false;
}

/** The action's error for a refused lifecycle check, worded for deactivation or reactivation. */
function lifecycleRefusalError(
	refusal: LifecycleRefusal,
	options: { action: "deactivate" | "reactivate"; userId: string },
) {
	const isActive = options.action === "reactivate";
	switch (refusal.type) {
		case "not_found":
			return new NotFoundError({
				message: "Employee not found",
				entityType: "employee",
			});
		case "actor_membership_missing":
			return new AuthorizationError({
				message: "You do not have access to employee settings",
				userId: options.userId,
				resource: "employee",
				action: options.action,
			});
		case "target_membership_missing":
			return new ValidationError({
				message: isActive
					? "This employee is no longer an approved organization member. Re-invite them before reactivating."
					: "This employee is not an approved organization member.",
				field: "employeeId",
			});
		case "self_target":
			return new AuthorizationError({
				message: `You cannot ${options.action} your own employee profile`,
				userId: options.userId,
				resource: "employee",
				action: options.action,
			});
		case "admin_targeting_owner":
			return new AuthorizationError({
				message: "Only an organization owner can change an owner's lifecycle state",
				userId: options.userId,
				resource: "employee",
				action: options.action,
			});
		case "final_accessible_owner":
			return new ValidationError({
				message: finalOwnerDeactivateGuidance,
				field: "employeeId",
			});
		case "rehire_required":
			return new ValidationError({
				message:
					"This employee has left the organization. Rehire them to start a new employment period.",
				field: "employeeId",
			});
	}
}

/** The signed-in actor's email, for the deactivation ledger and the audit entry. */
function actorEmail() {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		return session.user.email;
	});
}

/** Logs a failed lifecycle action and passes the failure on. */
function logged<A, E, R>(
	effect: Effect.Effect<A, E, R>,
	message: string,
	fields: Record<string, unknown>,
) {
	return effect.pipe(
		Effect.tapError((error) => Effect.sync(() => logger.error({ error, ...fields }, message))),
	);
}

/**
 * Deactivate (#1440, Organization ADR 0006): the employee becomes a former
 * employee with the same consequences as a departure taking effect, applied in
 * one transaction. The deactivation module (`deactivation/command.ts`) does all
 * of it; this action parses the input and words the refusals.
 * `{ employeeId, requestId, replacementManagers }`; a retry with the same request ID replays.
 */
export const deactivateEmployeeAction = organizationAction(
	{
		name: "employees.deactivate",
		requires: "orgAdmin",
		schema: deactivateEmployeeSchema,
		// The replacement managers take on the reports; each must be on the current roster.
		addsEmployees: (input) => Object.values(input.replacementManagers),
	},
	({ actor, organizationId, input: data }) =>
		logged(
			Effect.gen(function* () {
				const dbService = yield* DatabaseService;
				const email = yield* actorEmail();
				// The deactivation module takes its own locks, replays the request ID,
				// checks the owner rules, applies and runs its after-commit work.
				const outcome = yield* dbService
					.query("setEmployeeLifecycleState", () =>
						deactivate(dbService.db, {
							organizationId,
							actorUserId: actor.userId,
							actorEmail: email,
							employeeId: data.employeeId,
							requestId: data.requestId,
							replacementManagers: data.replacementManagers,
						}),
					)
					.pipe(
						Effect.mapError((error) =>
							isOwnerInvariantViolation(error)
								? new ValidationError({
										message: finalOwnerDeactivateGuidance,
										field: "employeeId",
									})
								: isRequestConflict(error)
									? new ValidationError({
											message: requestConflictMessage,
											field: "requestId",
											refusal: "request_conflict",
										})
									: error,
						),
					);

				if (outcome.kind === "refused") {
					const names = outcome.reports
						.map((report) => report.name || report.employeeId)
						.join(", ");
					return yield* Effect.fail(
						new ValidationError({
							message: `Choose a current admin or manager as the new manager of ${names}.`,
							field: "replacementManagers",
							refusal: "replacement_required",
						}),
					);
				}
				if (outcome.kind === "rejected") {
					return yield* Effect.fail(
						lifecycleRefusalError(outcome.refusal, {
							action: "deactivate",
							userId: actor.userId,
						}),
					);
				}

				revalidateEmployeesCache(organizationId);
			}),
			"Failed to deactivate employee",
			{ employeeId: data.employeeId, state: "inactive" },
		),
);

/**
 * Reactivate: the employee is on the current roster again. Nothing ended at
 * the deactivation is restored (Organization ADR 0006); the deactivation's
 * pending handovers stop.
 */
export const reactivateEmployeeAction = organizationAction(
	{ name: "employees.reactivate", requires: "orgAdmin", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		logged(
			Effect.gen(function* () {
				const dbService = yield* DatabaseService;
				// Identifies this reactivation in the ledger, the history event and the audit entry.
				const requestId = randomUUID();
				const transactionResult = yield* dbService
					.query("setEmployeeLifecycleState", async () => {
						// The target's active state feeds manual creation, so its protection
						// precedes the organization row lock and every write.
						return await withAuthorizationMutation(
							{ organizationId, employeeIds: [employeeId] },
							async (tx): Promise<ReactivationTransactionResult> => {
								// All lifecycle mutations for an organization take this row lock, serializing owner safety checks.
								if (!(await tryLockLifecycleOrganization(tx, organizationId))) {
									return { type: "not_found" };
								}

								const check = await checkLifecycleTarget(tx, {
									organizationId,
									actorUserId: actor.userId,
									employeeId,
									isActive: true,
								});
								if (check.type === "unchanged") {
									return {
										type: "success",
										changed: false,
										targetEmployee: check.targetEmployee,
									};
								}
								if (check.type !== "change") return check;

								// Restores nothing the deactivation ended (#1441); the admin
								// re-grants from the checklist.
								const audit = new AuditTrail();
								const reactivation = await executeReactivation(
									tx,
									{
										organizationId,
										actorUserId: actor.userId,
										employeeId,
										requestId,
										at: systemClock.nowInstant(),
									},
									audit,
								);
								if (reactivation.kind === "not_found") return { type: "not_found" };

								return {
									type: "success",
									changed: true,
									targetEmployee: check.targetEmployee,
									audit,
								};
							},
							dbService.db,
						);
					})
					.pipe(
						Effect.mapError((error) =>
							isOwnerInvariantViolation(error)
								? new ValidationError({
										message: finalOwnerDeactivateGuidance,
										field: "employeeId",
									})
								: error,
						),
					);

				if (transactionResult.type !== "success") {
					return yield* Effect.fail(
						lifecycleRefusalError(transactionResult, {
							action: "reactivate",
							userId: actor.userId,
						}),
					);
				}

				if (transactionResult.changed) {
					transactionResult.audit?.forwardCommitted();
					const email = yield* actorEmail();
					yield* Effect.promise(() =>
						logAudit({
							action: AuditAction.EMPLOYEE_REACTIVATED,
							actorId: actor.userId,
							actorEmail: email,
							employeeId: transactionResult.targetEmployee.id,
							targetId: transactionResult.targetEmployee.id,
							targetType: "employee",
							organizationId,
							changes: {
								isActive: {
									from: transactionResult.targetEmployee.isActive,
									to: true,
								},
							},
							// The employment history shows this reactivation once (#1441).
							metadata: { reactivationRequestId: requestId },
							timestamp: new Date(),
						}),
					);
					// Reactivation takes a paid seat again (#1439).
					yield* Effect.promise(() =>
						reconcileBillingSeatsForOrganization(organizationId, {
							alsoWhenBillingDisabled: true,
						}),
					);
				}

				revalidateEmployeesCache(organizationId);
			}),
			"Failed to reactivate employee",
			{ employeeId, state: "active" },
		),
);

/**
 * The advisory preview of Deactivate (#1440): what the deactivation would
 * change now with these replacement picks. Writes nothing; the deactivation
 * recomputes it on submit.
 */
export const previewEmployeeDeactivationAction = organizationAction(
	{
		name: "employees.previewDeactivation",
		requires: "orgAdmin",
		schema: previewEmployeeDeactivationSchema,
	},
	({ actor, organizationId, input: data }) =>
		logged(
			Effect.gen(function* () {
				const dbService = yield* DatabaseService;
				const refusalOptions = { action: "deactivate" as const, userId: actor.userId };
				const result = yield* dbService.query("previewEmployeeDeactivation", () =>
					previewEmployeeDeactivation(dbService.db, {
						organizationId,
						employeeId: data.employeeId,
						actorUserId: actor.userId,
						replacementManagers: data.replacementManagers,
						now: systemClock.nowInstant(),
					}),
				);
				switch (result.kind) {
					case "ok":
						return result.plan;
					case "not_found":
						return yield* Effect.fail(lifecycleRefusalError({ type: "not_found" }, refusalOptions));
					case "forbidden":
						return yield* Effect.fail(
							lifecycleRefusalError(
								{
									type:
										result.code === "actor_not_authorized"
											? "actor_membership_missing"
											: result.code,
								},
								refusalOptions,
							),
						);
					case "invalid":
						return yield* Effect.fail(
							result.code === "already_inactive"
								? new ValidationError({
										message: "This employee is already deactivated.",
										field: "employeeId",
									})
								: lifecycleRefusalError({ type: result.code }, refusalOptions),
						);
				}
			}),
			"Failed to preview employee deactivation",
			{ employeeId: data.employeeId },
		),
);

/** Removes the employee's organization access; owners only. */
export const removeEmployeeAccessAction = organizationAction(
	{ name: "employees.removeAccess", requires: "owner", schema: employeeIdSchema },
	({ actor, organizationId, input: employeeId }) =>
		logged(
			Effect.gen(function* () {
				const dbService = yield* DatabaseService;
				const targetEmployee = yield* dbService.query(
					"removeEmployeeAccess:targetEmployee",
					async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
							columns: { id: true, userId: true },
						});
					},
				);
				if (!targetEmployee) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
						}),
					);
				}
				if (targetEmployee.userId === actor.userId) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You cannot remove your own organization access",
							userId: actor.userId,
							resource: "employee",
							action: "remove_access",
						}),
					);
				}
				const retryPostRemovalCleanup = () =>
					Effect.tryPromise({
						try: () =>
							completeRemovedMemberCleanup({
								organizationId,
								userId: targetEmployee.userId,
								// Its deputy release is audited under this admin (#1014).
								actorUserId: actor.userId,
							}),
						catch: () =>
							new ValidationError({
								message:
									"Employee access was removed, but cleanup is still pending. Retry removing access.",
								field: "employeeId",
							}),
					});

				const targetMembership = yield* dbService.query(
					"removeEmployeeAccess:targetMembership",
					async () => {
						return await dbService.db.query.member.findFirst({
							where: and(
								eq(member.userId, targetEmployee.userId),
								eq(member.organizationId, organizationId),
								eq(member.status, "approved"),
							),
							columns: { id: true },
						});
					},
				);
				if (!targetMembership) {
					revalidateEmployeesCache(organizationId);
					yield* retryPostRemovalCleanup();
					return;
				}

				const removalOutcome = yield* Effect.tryPromise({
					try: async () => {
						const requestHeaders = await headers();
						// Removal, its access guard and employee deactivation commit together (#314).
						await runAuthMutation(() =>
							auth.api.removeMember({
								body: {
									organizationId,
									memberIdOrEmail: targetMembership.id,
								},
								headers: requestHeaders,
							}),
						);
					},
					catch: (cause) => cause,
				}).pipe(
					Effect.map(() => ({ success: true as const })),
					Effect.catch((cause) => Effect.succeed({ success: false as const, cause })),
				);

				if (!removalOutcome.success) {
					const remainingMembership = yield* dbService.query(
						"removeEmployeeAccess:commitCheck",
						async () => {
							return await dbService.db.query.member.findFirst({
								where: and(
									eq(member.id, targetMembership.id),
									eq(member.organizationId, organizationId),
								),
								columns: { id: true },
							});
						},
					);

					if (remainingMembership) {
						return yield* Effect.fail(
							new ValidationError({
								message: isFinalOwnerRemovalError(removalOutcome.cause)
									? removeFinalOwnerGuidance
									: "Employee access could not be removed. Please try again.",
								field: "employeeId",
							}),
						);
					}

					revalidateEmployeesCache(organizationId);
					yield* retryPostRemovalCleanup();
					return;
				}

				// A removed owner or admin can no longer own scheduled exports (#988).
				yield* dbService.query("scheduledExport.pauseAfterRemoval", () =>
					pauseSchedulesAfterOwnerAccessChange(dbService.db, {
						organizationId,
						owner: { userId: targetEmployee.userId },
						actorUserId: actor.userId,
					}),
				);

				revalidateEmployeesCache(organizationId);
			}),
			"Failed to remove employee access",
			{ employeeId },
		),
);
