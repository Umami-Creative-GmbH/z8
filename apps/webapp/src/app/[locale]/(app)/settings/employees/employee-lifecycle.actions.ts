"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { auth, runAuthMutation } from "@/lib/auth";
import { completeRemovedMemberCleanup } from "@/lib/auth/member-removal-cleanup";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { revokeOrganizationActiveSessions } from "@/lib/auth/organization-session-revocation";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	type DeactivationCommand,
	deactivationProtectionScope,
	deactivationRequestFingerprint,
	executeDeactivation,
	rebuildDeactivationAfterCommit,
} from "@/lib/employee-lifecycle/deactivation/command";
import { previewEmployeeDeactivation } from "@/lib/employee-lifecycle/deactivation/preview";
import type {
	DeactivationAfterCommit,
	DeactivationPlan,
	NamedEmployee,
} from "@/lib/employee-lifecycle/deactivation/types";
import type { ReleasedDeputyAssignments } from "@/lib/employee-lifecycle/deputy-release";
import { notifyReleasedDeputyAssignments } from "@/lib/employee-lifecycle/deputy-release-runtime";
import {
	checkLifecycleTarget,
	type LifecycleTargetCheck,
	type LifecycleTargetEmployee,
} from "@/lib/employee-lifecycle/lifecycle-target";
import {
	DeactivationRequestConflictError,
	markDeactivationReactivated,
	readDeactivationByRequest,
} from "@/lib/employee-lifecycle/receipts";
import { createLogger } from "@/lib/logger";
import { pauseSchedulesAfterOwnerAccessChange } from "@/lib/scheduled-exports/application/owner-access-change";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

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

const ownerInvariantViolationMessage =
	"Organization must retain an approved accessible owner";
const finalOwnerDeactivateGuidance =
	"Assign and activate another approved owner before deactivating this employee";
const removeFinalOwnerGuidance =
	"Assign and activate another approved owner before removing this employee's access";
const requestConflictMessage =
	"This deactivation was already submitted with different choices. Review the preview and try again.";

type LifecycleRefusal = Exclude<LifecycleTargetCheck, { type: "change" } | { type: "unchanged" }>;

type ReactivationTransactionResult =
	| { type: "success"; changed: boolean; targetEmployee: LifecycleTargetEmployee }
	| LifecycleRefusal;

type DeactivationTransactionResult =
	| {
			type: "success";
			changed: boolean;
			targetEmployee: LifecycleTargetEmployee;
			audit: AuditTrail | null;
			afterCommit: DeactivationAfterCommit[];
			releasedDeputies: ReleasedDeputyAssignments | null;
	  }
	/** The same request again: its stored result, with the after-commit work rebuilt. */
	| {
			type: "replay";
			targetUserId: string | null;
			reactivated: boolean;
			afterCommit: DeactivationAfterCommit[];
			releasedDeputies: ReleasedDeputyAssignments | null;
	  }
	| {
			type: "refused";
			reports: Array<NamedEmployee & { refusal: "replacement_missing" | "replacement_ineligible" }>;
	  }
	| LifecycleRefusal;

function isOwnerInvariantViolation(error: DatabaseError) {
	let cause: unknown = error.cause;

	for (
		let depth = 0;
		depth < 4 && cause && typeof cause === "object";
		depth += 1
	) {
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
			if (
				normalized.includes("last owner") ||
				normalized.includes("approved accessible owner")
			) {
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
		candidates.push(
			errorRecord.code,
			errorRecord.message,
			errorRecord.body,
			errorRecord.cause,
		);
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
			return new NotFoundError({ message: "Employee not found", entityType: "employee" });
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
			return new ValidationError({ message: finalOwnerDeactivateGuidance, field: "employeeId" });
		case "rehire_required":
			return new ValidationError({
				message:
					"This employee has left the organization. Rehire them to start a new employment period.",
				field: "employeeId",
			});
	}
}

/** Runs after-commit steps one after another; a failure is logged and never undoes the commit. */
async function runAfterCommit(steps: DeactivationAfterCommit[], context: Record<string, unknown>) {
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			logger.warn({ error, ...context }, "Deactivation follow-up step failed after the commit");
		}
	}
}

/**
 * Deactivate (#1440, Organization ADR 0006): the employee becomes a former
 * employee with the same consequences as a departure taking effect, applied in
 * one transaction. The request ID makes a retried submission replay the first
 * result; the plan is recomputed here and refused when a report still needs an
 * eligible replacement manager.
 */
function deactivateEmployee(input: unknown) {
	const employeeId =
		typeof input === "object" && input !== null && "employeeId" in input
			? String((input as { employeeId: unknown }).employeeId)
			: "";

	return runTracedEmployeeAction({
		name: "deactivateEmployee",
		attributes: {
			"employee.id": employeeId,
			"employee.lifecycleState": "inactive",
		},
		logError: (error) => {
			logger.error({ error, employeeId, state: "inactive" }, "Failed to deactivate employee");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					queryName: "setEmployeeLifecycleState:actor",
				});
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization owners and admins can change employee lifecycle state",
					resource: "employee",
					action: "deactivate",
				});
				const data = yield* validateInput(deactivateEmployeeSchema, input, "employeeId");
				const command: DeactivationCommand = {
					organizationId: actor.organizationId,
					actorUserId: actor.session.user.id,
					employeeId: data.employeeId,
					requestId: data.requestId,
					replacementManagers: data.replacementManagers,
				};
				const requestFingerprint = deactivationRequestFingerprint(command);

				const transactionResult = yield* actor.dbService
					.query("setEmployeeLifecycleState", async () => {
						return await withAuthorizationMutation(
							deactivationProtectionScope(command),
							async (tx): Promise<DeactivationTransactionResult> => {
								// All lifecycle mutations for an organization take this row lock, serializing owner safety checks.
								const [lockedOrganization] = await tx
									.select({ id: organization.id })
									.from(organization)
									.where(eq(organization.id, actor.organizationId))
									.for("update");
								if (!lockedOrganization) return { type: "not_found" };

								const recorded = await readDeactivationByRequest(tx, {
									organizationId: actor.organizationId,
									requestId: command.requestId,
									requestFingerprint,
								});
								if (recorded) {
									const rebuilt = rebuildDeactivationAfterCommit(recorded);
									return {
										type: "replay",
										targetUserId: rebuilt.result?.employeeUserId ?? null,
										reactivated: recorded.reactivatedAt !== null,
										afterCommit: rebuilt.afterCommit,
										releasedDeputies: rebuilt.releasedDeputies,
									};
								}

								const check = await checkLifecycleTarget(tx, {
									organizationId: actor.organizationId,
									actorUserId: actor.session.user.id,
									employeeId: command.employeeId,
									isActive: false,
								});
								if (check.type === "unchanged") {
									return {
										type: "success",
										changed: false,
										targetEmployee: check.targetEmployee,
										audit: null,
										afterCommit: [],
										releasedDeputies: null,
									};
								}
								if (check.type !== "change") return check;

								// The instant every consequence uses, taken once the locks are held.
								const execution = await executeDeactivation(tx, {
									...command,
									at: systemClock.nowInstant(),
									requestFingerprint,
								});
								if (execution.kind === "refused") {
									return { type: "refused", reports: execution.reports };
								}
								return {
									type: "success",
									changed: true,
									targetEmployee: check.targetEmployee,
									audit: execution.audit,
									afterCommit: execution.afterCommit,
									releasedDeputies: execution.releasedDeputies,
								};
							},
							actor.dbService.db,
						);
					})
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

				if (transactionResult.type === "refused") {
					const names = transactionResult.reports
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
				if (transactionResult.type !== "success" && transactionResult.type !== "replay") {
					return yield* Effect.fail(
						lifecycleRefusalError(transactionResult, {
							action: "deactivate",
							userId: actor.session.user.id,
						}),
					);
				}

				if (transactionResult.type === "replay" && transactionResult.reactivated) {
					// Reactivated since: nothing to repeat for the earlier deactivation.
					revalidateEmployeesCache(actor.organizationId);
					return;
				}

				const context = { employeeId: command.employeeId, organizationId: actor.organizationId };
				const targetUserId =
					transactionResult.type === "replay"
						? transactionResult.targetUserId
						: transactionResult.targetEmployee.userId;
				// Everything the deactivation committed, on the first run and again on a replay.
				const applied = transactionResult.type === "replay" || transactionResult.changed;

				if (transactionResult.type === "success") transactionResult.audit?.forwardCommitted();
				yield* Effect.promise(() => runAfterCommit(transactionResult.afterCommit, context));

				const revocationFailed =
					targetUserId === null
						? false
						: yield* Effect.tryPromise({
								try: () => revokeOrganizationActiveSessions(targetUserId, actor.organizationId),
								catch: () => true,
							}).pipe(
								Effect.map(() => false),
								Effect.catch(() => Effect.succeed(true)),
							);

				if (transactionResult.type === "success" && transactionResult.changed) {
					yield* Effect.promise(() =>
						logAudit({
							action: AuditAction.EMPLOYEE_DEACTIVATED,
							actorId: actor.session.user.id,
							actorEmail: actor.session.user.email,
							employeeId: transactionResult.targetEmployee.id,
							targetId: transactionResult.targetEmployee.id,
							targetType: "employee",
							organizationId: actor.organizationId,
							changes: {
								isActive: { from: transactionResult.targetEmployee.isActive, to: false },
							},
							timestamp: new Date(),
						}),
					);
				}

				if (applied) {
					// A former employee holds no paid seat (#1439). Best effort after the commit, as for
					// member removal (but recounting the local seats even while external billing is off,
					// as a departure does): a failed delivery is logged, and the billing seat
					// reconciliation job settles it.
					yield* Effect.promise(() =>
						reconcileBillingSeatsForOrganization(actor.organizationId, {
							alsoWhenBillingDisabled: true,
						}),
					);
				}

				if (applied && targetUserId !== null) {
					// A deactivated owner or admin can no longer own scheduled exports (#988).
					yield* actor.dbService.query("scheduledExport.pauseAfterDeactivation", () =>
						pauseSchedulesAfterOwnerAccessChange(actor.dbService.db, {
							organizationId: actor.organizationId,
							owner: { userId: targetUserId },
							actorUserId: actor.session.user.id,
						}),
					);
				}

				if (transactionResult.releasedDeputies) {
					const releasedDeputies = transactionResult.releasedDeputies;
					// After the commit, on the caller's database client (#1014); never throws.
					yield* Effect.promise(() =>
						notifyReleasedDeputyAssignments(releasedDeputies, actor.dbService.db),
					);
				}

				revalidateEmployeesCache(actor.organizationId);

				if (revocationFailed) {
					logger.warn(
						{
							operation: "revokeOrganizationActiveSessions",
							employeeId: command.employeeId,
							organizationId: actor.organizationId,
							targetUserId,
						},
						"Employee deactivated with session cleanup pending",
					);
				}
			}),
	});
}

/**
 * Reactivate: the employee is on the current roster again. Nothing ended at
 * the deactivation is restored (Organization ADR 0006); the deactivation's
 * pending handovers stop.
 */
function reactivateEmployee(employeeId: string) {
	return runTracedEmployeeAction({
		name: "reactivateEmployee",
		attributes: {
			"employee.id": employeeId,
			"employee.lifecycleState": "active",
		},
		logError: (error) => {
			logger.error({ error, employeeId, state: "active" }, "Failed to reactivate employee");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					queryName: "setEmployeeLifecycleState:actor",
				});
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization owners and admins can change employee lifecycle state",
					resource: "employee",
					action: "reactivate",
				});

				const validatedEmployeeId = yield* validateInput(employeeIdSchema, employeeId, "employeeId");
				const transactionResult = yield* actor.dbService
					.query("setEmployeeLifecycleState", async () => {
						// The target's active state feeds manual creation, so its protection
						// precedes the organization row lock and every write.
						return await withAuthorizationMutation(
							{ organizationId: actor.organizationId, employeeIds: [validatedEmployeeId] },
							async (tx): Promise<ReactivationTransactionResult> => {
								// All lifecycle mutations for an organization take this row lock, serializing owner safety checks.
								const [lockedOrganization] = await tx
									.select({ id: organization.id })
									.from(organization)
									.where(eq(organization.id, actor.organizationId))
									.for("update");
								if (!lockedOrganization) return { type: "not_found" };

								const check = await checkLifecycleTarget(tx, {
									organizationId: actor.organizationId,
									actorUserId: actor.session.user.id,
									employeeId: validatedEmployeeId,
									isActive: true,
								});
								if (check.type === "unchanged") {
									return { type: "success", changed: false, targetEmployee: check.targetEmployee };
								}
								if (check.type !== "change") return check;

								const [updatedEmployee] = await tx
									.update(employee)
									.set({ isActive: true })
									.where(
										and(
											eq(employee.id, validatedEmployeeId),
											eq(employee.organizationId, actor.organizationId),
										),
									)
									.returning({ id: employee.id });
								if (!updatedEmployee) return { type: "not_found" };

								// The open deactivation ends; its pending handovers stop (#1440).
								await markDeactivationReactivated(tx, {
									organizationId: actor.organizationId,
									employeeId: validatedEmployeeId,
									reactivatedAt: systemClock.nowInstant(),
									reactivatedBy: actor.session.user.id,
									reactivationRequestId: null,
								});

								return { type: "success", changed: true, targetEmployee: check.targetEmployee };
							},
							actor.dbService.db,
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
							userId: actor.session.user.id,
						}),
					);
				}

				if (transactionResult.changed) {
					yield* Effect.promise(() =>
						logAudit({
							action: AuditAction.EMPLOYEE_REACTIVATED,
							actorId: actor.session.user.id,
							actorEmail: actor.session.user.email,
							employeeId: transactionResult.targetEmployee.id,
							targetId: transactionResult.targetEmployee.id,
							targetType: "employee",
							organizationId: actor.organizationId,
							changes: {
								isActive: {
									from: transactionResult.targetEmployee.isActive,
									to: true,
								},
							},
							timestamp: new Date(),
						}),
					);
					// Reactivation takes a paid seat again (#1439).
					yield* Effect.promise(() =>
						reconcileBillingSeatsForOrganization(actor.organizationId, {
							alsoWhenBillingDisabled: true,
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}

export async function deactivateEmployeeAction(
	input: DeactivateEmployeeInput,
): Promise<ServerActionResult<void>> {
	return deactivateEmployee(input);
}

export async function reactivateEmployeeAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return reactivateEmployee(employeeId);
}

/**
 * The advisory preview of Deactivate (#1440): what the deactivation would
 * change now with these replacement picks. Writes nothing; the deactivation
 * recomputes it on submit.
 */
export async function previewEmployeeDeactivationAction(
	input: PreviewEmployeeDeactivationInput,
): Promise<ServerActionResult<DeactivationPlan>> {
	return runTracedEmployeeAction({
		name: "previewEmployeeDeactivation",
		logError: (error) => {
			logger.error({ error }, "Failed to preview employee deactivation");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					queryName: "previewEmployeeDeactivation:actor",
				});
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization owners and admins can change employee lifecycle state",
					resource: "employee",
					action: "deactivate",
				});
				const data = yield* validateInput(previewEmployeeDeactivationSchema, input, "employeeId");
				const result = yield* actor.dbService.query("previewEmployeeDeactivation", () =>
					previewEmployeeDeactivation(actor.dbService.db, {
						organizationId: actor.organizationId,
						employeeId: data.employeeId,
						actorUserId: actor.session.user.id,
						replacementManagers: data.replacementManagers,
						now: systemClock.nowInstant(),
					}),
				);
				switch (result.kind) {
					case "ok":
						return result.plan;
					case "not_found":
						return yield* Effect.fail(
							lifecycleRefusalError(
								{ type: "not_found" },
								{ action: "deactivate", userId: actor.session.user.id },
							),
						);
					case "forbidden":
						return yield* Effect.fail(
							lifecycleRefusalError(
								{
									type:
										result.code === "actor_not_authorized"
											? "actor_membership_missing"
											: result.code,
								},
								{ action: "deactivate", userId: actor.session.user.id },
							),
						);
					case "invalid":
						return yield* Effect.fail(
							result.code === "already_inactive"
								? new ValidationError({
										message: "This employee is already deactivated.",
										field: "employeeId",
									})
								: lifecycleRefusalError(
										{ type: result.code },
										{ action: "deactivate", userId: actor.session.user.id },
									),
						);
				}
			}),
	});
}

export async function removeEmployeeAccessAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "removeEmployeeAccess",
		attributes: { "employee.id": employeeId },
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to remove employee access");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					queryName: "removeEmployeeAccess:actor",
				});
				const validatedEmployeeId = yield* validateInput(employeeIdSchema, employeeId, "employeeId");

				const actorMembership = yield* actor.dbService.query(
					"removeEmployeeAccess:actorMembership",
					async () => {
						return await actor.dbService.db.query.member.findFirst({
							where: and(
								eq(member.userId, actor.session.user.id),
								eq(member.organizationId, actor.organizationId),
								eq(member.status, "approved"),
							),
							columns: { role: true },
						});
					},
				);
				if (
					!actorMembership ||
					!hasOrganizationRole(actorMembership.role, "owner")
				) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "Only organization owners can remove employee access",
							userId: actor.session.user.id,
							resource: "employee",
							action: "remove_access",
						}),
					);
				}

				const targetEmployee = yield* actor.dbService.query(
					"removeEmployeeAccess:targetEmployee",
					async () => {
						return await actor.dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, validatedEmployeeId),
								eq(employee.organizationId, actor.organizationId),
							),
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
				if (targetEmployee.userId === actor.session.user.id) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You cannot remove your own organization access",
							userId: actor.session.user.id,
							resource: "employee",
							action: "remove_access",
						}),
					);
				}
				const retryPostRemovalCleanup = () =>
					Effect.tryPromise({
						try: () =>
							completeRemovedMemberCleanup({
								organizationId: actor.organizationId,
								userId: targetEmployee.userId,
								// Its deputy release is audited under this admin (#1014).
								actorUserId: actor.session.user.id,
							}),
						catch: () =>
							new ValidationError({
								message:
									"Employee access was removed, but cleanup is still pending. Retry removing access.",
								field: "employeeId",
							}),
					});

				const targetMembership = yield* actor.dbService.query(
					"removeEmployeeAccess:targetMembership",
					async () => {
						return await actor.dbService.db.query.member.findFirst({
							where: and(
								eq(member.userId, targetEmployee.userId),
								eq(member.organizationId, actor.organizationId),
								eq(member.status, "approved"),
							),
							columns: { id: true },
						});
					},
				);
				if (!targetMembership) {
					revalidateEmployeesCache(actor.organizationId);
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
									organizationId: actor.organizationId,
									memberIdOrEmail: targetMembership.id,
								},
								headers: requestHeaders,
							}),
						);
					},
					catch: (cause) => cause,
				}).pipe(
					Effect.map(() => ({ success: true as const })),
					Effect.catch((cause) =>
						Effect.succeed({ success: false as const, cause }),
					),
				);

				if (!removalOutcome.success) {
					const remainingMembership = yield* actor.dbService.query(
						"removeEmployeeAccess:commitCheck",
						async () => {
							return await actor.dbService.db.query.member.findFirst({
								where: and(
									eq(member.id, targetMembership.id),
									eq(member.organizationId, actor.organizationId),
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

					revalidateEmployeesCache(actor.organizationId);
					yield* retryPostRemovalCleanup();
					return;
				}

				// A removed owner or admin can no longer own scheduled exports (#988).
				yield* actor.dbService.query("scheduledExport.pauseAfterRemoval", () =>
					pauseSchedulesAfterOwnerAccessChange(actor.dbService.db, {
						organizationId: actor.organizationId,
						owner: { userId: targetEmployee.userId },
						actorUserId: actor.session.user.id,
					}),
				);

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
