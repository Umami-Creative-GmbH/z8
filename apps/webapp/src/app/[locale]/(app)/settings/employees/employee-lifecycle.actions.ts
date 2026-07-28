"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import { member, organization } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";
import { completeRemovedMemberCleanup } from "@/lib/auth/member-removal-cleanup";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { revokeOrganizationActiveSessions } from "@/lib/auth/organization-session-revocation";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { createLogger } from "@/lib/logger";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

const logger = createLogger("EmployeeLifecycleActions");
const employeeIdSchema = z.uuid("Invalid employee ID");
const ownerInvariantViolationMessage =
	"Organization must retain an approved accessible owner";
const removeFinalOwnerGuidance =
	"Assign and activate another approved owner before removing this employee's access";

type EmployeeLifecycleState = "active" | "inactive";

type LifecycleTransactionResult =
	| {
			type: "success";
			changed: boolean;
			targetEmployee: Pick<
				typeof employee.$inferSelect,
				"id" | "userId" | "isActive"
			>;
	  }
	| { type: "not_found" }
	| { type: "actor_membership_missing" }
	| { type: "target_membership_missing" }
	| { type: "self_target" }
	| { type: "admin_targeting_owner" }
	| { type: "final_accessible_owner" };

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

function setEmployeeLifecycleState(
	employeeId: string,
	state: EmployeeLifecycleState,
) {
	const isActive = state === "active";
	const action = isActive ? "reactivate" : "deactivate";

	return runTracedEmployeeAction({
		name: `${action}Employee`,
		attributes: {
			"employee.id": employeeId,
			"employee.lifecycleState": state,
		},
		logError: (error) => {
			logger.error(
				{ error, employeeId, state },
				`Failed to ${action} employee`,
			);
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actor = yield* _(
					getEmployeeSettingsActorContext({
						queryName: "setEmployeeLifecycleState:actor",
					}),
				);
				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message:
							"Only organization owners and admins can change employee lifecycle state",
						resource: "employee",
						action,
					}),
				);

				const validatedEmployeeId = yield* _(
					validateInput(employeeIdSchema, employeeId, "employeeId"),
				);
				const transactionResult = yield* _(
					actor.dbService
						.query("setEmployeeLifecycleState", async () => {
							return await actor.dbService.db.transaction(
								async (tx): Promise<LifecycleTransactionResult> => {
									// All lifecycle mutations for an organization take this row lock, serializing owner safety checks.
									const [lockedOrganization] = await tx
										.select({ id: organization.id })
										.from(organization)
										.where(eq(organization.id, actor.organizationId))
										.for("update");
									if (!lockedOrganization) return { type: "not_found" };

									const actorMembership = await tx.query.member.findFirst({
										where: and(
											eq(member.userId, actor.session.user.id),
											eq(member.organizationId, actor.organizationId),
											eq(member.status, "approved"),
										),
										columns: { role: true, userId: true },
									});
									if (!actorMembership)
										return { type: "actor_membership_missing" };
									const actorIsOwner = hasOrganizationRole(
										actorMembership.role,
										"owner",
									);
									const actorIsAdmin = hasOrganizationRole(
										actorMembership.role,
										"admin",
									);
									if (!actorIsOwner && !actorIsAdmin) {
										return { type: "actor_membership_missing" };
									}

									const targetEmployee = await tx.query.employee.findFirst({
										where: and(
											eq(employee.id, validatedEmployeeId),
											eq(employee.organizationId, actor.organizationId),
										),
										columns: { id: true, userId: true, isActive: true },
									});
									if (!targetEmployee) return { type: "not_found" };

									const targetMembership = await tx.query.member.findFirst({
										where: and(
											eq(member.userId, targetEmployee.userId),
											eq(member.organizationId, actor.organizationId),
											eq(member.status, "approved"),
										),
										columns: { role: true, userId: true },
									});
									if (!targetMembership)
										return { type: "target_membership_missing" };
									if (targetEmployee.userId === actor.session.user.id)
										return { type: "self_target" };
									const targetIsOwner = hasOrganizationRole(
										targetMembership.role,
										"owner",
									);
									if (!actorIsOwner && actorIsAdmin && targetIsOwner) {
										return { type: "admin_targeting_owner" };
									}

									if (targetEmployee.isActive === isActive) {
										return { type: "success", changed: false, targetEmployee };
									}

									if (!isActive && targetIsOwner) {
										const approvedOwners = await tx
											.select({
												userId: member.userId,
												role: member.role,
												employeeIsActive: employee.isActive,
											})
											.from(member)
											.leftJoin(
												employee,
												and(
													eq(employee.userId, member.userId),
													eq(employee.organizationId, actor.organizationId),
												),
											)
											.where(
												and(
													eq(member.organizationId, actor.organizationId),
													eq(member.status, "approved"),
												),
											);
										const hasAlternativeAccessibleOwner = approvedOwners.some(
											(owner) =>
												owner.userId !== targetEmployee.userId &&
												hasOrganizationRole(owner.role, "owner") &&
												owner.employeeIsActive !== false,
										);
										if (!hasAlternativeAccessibleOwner)
											return { type: "final_accessible_owner" };
									}

									const [updatedEmployee] = await tx
										.update(employee)
										.set({ isActive })
										.where(
											and(
												eq(employee.id, validatedEmployeeId),
												eq(employee.organizationId, actor.organizationId),
											),
										)
										.returning({ id: employee.id });
									if (!updatedEmployee) return { type: "not_found" };

									return { type: "success", changed: true, targetEmployee };
								},
							);
						})
						.pipe(
							Effect.mapError((error) =>
								isOwnerInvariantViolation(error)
									? new ValidationError({
											message:
												"Assign and activate another approved owner before deactivating this employee",
											field: "employeeId",
										})
									: error,
							),
						),
				);

				switch (transactionResult.type) {
					case "not_found":
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
								}),
							),
						);
					case "actor_membership_missing":
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "You do not have access to employee settings",
									userId: actor.session.user.id,
									resource: "employee",
									action,
								}),
							),
						);
					case "target_membership_missing":
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: isActive
										? "This employee is no longer an approved organization member. Re-invite them before reactivating."
										: "This employee is not an approved organization member.",
									field: "employeeId",
								}),
							),
						);
					case "self_target":
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: `You cannot ${action} your own employee profile`,
									userId: actor.session.user.id,
									resource: "employee",
									action,
								}),
							),
						);
					case "admin_targeting_owner":
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message:
										"Only an organization owner can change an owner's lifecycle state",
									userId: actor.session.user.id,
									resource: "employee",
									action,
								}),
							),
						);
					case "final_accessible_owner":
						return yield* _(
							Effect.fail(
								new ValidationError({
									message:
										"Assign and activate another approved owner before deactivating this employee",
									field: "employeeId",
								}),
							),
						);
				}

				const revocationFailed = !isActive
					? yield* _(
							Effect.tryPromise({
								try: () =>
									revokeOrganizationActiveSessions(
										transactionResult.targetEmployee.userId,
										actor.organizationId,
									),
								catch: () => true,
							}).pipe(
								Effect.map(() => false),
								Effect.catchAll(() => Effect.succeed(true)),
							),
						)
					: null;

				if (transactionResult.changed) {
					yield* _(
						Effect.promise(() =>
							logAudit({
								action: isActive
									? AuditAction.EMPLOYEE_REACTIVATED
									: AuditAction.EMPLOYEE_DEACTIVATED,
								actorId: actor.session.user.id,
								actorEmail: actor.session.user.email,
								employeeId: transactionResult.targetEmployee.id,
								targetId: transactionResult.targetEmployee.id,
								targetType: "employee",
								organizationId: actor.organizationId,
								changes: {
									isActive: {
										from: transactionResult.targetEmployee.isActive,
										to: isActive,
									},
								},
								timestamp: new Date(),
							}),
						),
					);
				}

				revalidateEmployeesCache(actor.organizationId);

				if (revocationFailed) {
					logger.warn(
						{
							operation: "revokeOrganizationActiveSessions",
							employeeId: transactionResult.targetEmployee.id,
							organizationId: actor.organizationId,
							targetUserId: transactionResult.targetEmployee.userId,
						},
						"Employee deactivated with session cleanup pending",
					);
				}
			}),
	});
}

export async function deactivateEmployeeAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return setEmployeeLifecycleState(employeeId, "inactive");
}

export async function reactivateEmployeeAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return setEmployeeLifecycleState(employeeId, "active");
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
			Effect.gen(function* (_) {
				const actor = yield* _(
					getEmployeeSettingsActorContext({
						queryName: "removeEmployeeAccess:actor",
					}),
				);
				const validatedEmployeeId = yield* _(
					validateInput(employeeIdSchema, employeeId, "employeeId"),
				);

				const actorMembership = yield* _(
					actor.dbService.query(
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
					),
				);
				if (
					!actorMembership ||
					!hasOrganizationRole(actorMembership.role, "owner")
				) {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only organization owners can remove employee access",
								userId: actor.session.user.id,
								resource: "employee",
								action: "remove_access",
							}),
						),
					);
				}

				const targetEmployee = yield* _(
					actor.dbService.query(
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
					),
				);
				if (!targetEmployee) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
							}),
						),
					);
				}
				if (targetEmployee.userId === actor.session.user.id) {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "You cannot remove your own organization access",
								userId: actor.session.user.id,
								resource: "employee",
								action: "remove_access",
							}),
						),
					);
				}
				const retryPostRemovalCleanup = () =>
					Effect.tryPromise({
						try: () =>
							completeRemovedMemberCleanup({
								organizationId: actor.organizationId,
								userId: targetEmployee.userId,
							}),
						catch: () =>
							new ValidationError({
								message:
									"Employee access was removed, but cleanup is still pending. Retry removing access.",
								field: "employeeId",
							}),
					});

				const targetMembership = yield* _(
					actor.dbService.query(
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
					),
				);
				if (!targetMembership) {
					revalidateEmployeesCache(actor.organizationId);
					yield* _(retryPostRemovalCleanup());
					return;
				}

				const removalOutcome = yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.removeMember({
								body: {
									organizationId: actor.organizationId,
									memberIdOrEmail: targetMembership.id,
								},
								headers: await headers(),
							});
						},
						catch: (cause) => cause,
					}).pipe(
						Effect.map(() => ({ success: true as const })),
						Effect.catchAll((cause) =>
							Effect.succeed({ success: false as const, cause }),
						),
					),
				);

				if (!removalOutcome.success) {
					const remainingMembership = yield* _(
						actor.dbService.query(
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
						),
					);

					if (remainingMembership) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: isFinalOwnerRemovalError(removalOutcome.cause)
										? removeFinalOwnerGuidance
										: "Employee access could not be removed. Please try again.",
									field: "employeeId",
								}),
							),
						);
					}

					revalidateEmployeesCache(actor.organizationId);
					yield* _(retryPostRemovalCleanup());
					return;
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}
