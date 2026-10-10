"use server";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { z } from "zod";
import { invitation, user } from "@/db/auth-schema";
import {
	employee,
	employeeInvitationDraft,
	employeeRateHistory,
	team,
} from "@/db/schema";
import { toAuthStructuredName } from "@/lib/auth/derived-user-name";
import {
	acquireEmployeeIdentityLock,
	isEmployeeIdentityConflict,
} from "@/lib/auth/employee-identity-lock";
import { isInvitationActionable } from "@/lib/auth/employee-invitation-draft";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { createLogger } from "@/lib/logger";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import {
	type AssignManagers,
	assignManagersSchema,
	type CreateEmployee,
	createEmployeeSchema,
	type PersonalInformation,
	personalInformationSchema,
	type UpdateEmployee,
	type UpdateEmployeeInvitationDraft,
	updateEmployeeInvitationDraftSchema,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import {
	markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild,
} from "@/lib/work-balance/service";
import { decodeEmployeeInvitationDraftId } from "./employee-action-types";
import {
	ensureSettingsActorCanAccessEmployeeTarget,
	getEmployeeContext,
	getEmployeeSettingsActorContext,
	getTargetEmployee,
	getTargetUser,
	parseHourlyRate,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";
import { buildEligibleInvitationDraftPredicate } from "./employee-invitation-draft-eligibility";
import { filterEmployeeUpdateForScopedManager } from "./employee-scope";

const logger = createLogger("EmployeeActions");
const employeeIdSchema = z.uuid("Invalid employee ID");
const invitationCancellationFailureMessage =
	"The pending invitation could not be canceled. The employee draft was kept.";

export async function createEmployeeAction(
	data: CreateEmployee,
): Promise<ServerActionResult<typeof employee.$inferSelect>> {
	return runTracedEmployeeAction({
		name: "createEmployee",
		attributes: {
			"employee.organizationId": data.organizationId,
			"employee.role": data.role,
		},
		logError: (error) => {
			logger.error({ error }, "Failed to create employee");
		},
		execute: (span) =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({
					organizationId: data.organizationId,
				});
				const { session, dbService } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can create employee records",
					resource: "employee",
					action: "create",
				});

				if (actor.currentEmployee) {
					span.setAttribute("currentEmployee.id", actor.currentEmployee.id);
				}

				const validatedData = yield* validateInput(createEmployeeSchema, data);

				yield* getTargetUser(validatedData.userId);

				const existing = yield* dbService.query("checkExistingEmployee", async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, validatedData.userId),
							eq(employee.organizationId, validatedData.organizationId),
						),
					});
				});

				if (existing) {
					return yield* Effect.fail(
						new ValidationError({
							message:
								"Employee already exists for this user in this organization",
							field: "userId",
						}),
					);
				}

				const hourlyRateValue = parseHourlyRate(validatedData.hourlyRate);

				const [newEmployee] = yield* dbService
					.query("createEmployee", () =>
						// A new employee row gives the user an employee role and team in
						// the organization: an absent-row insertion under their protection.
						withAuthorizationMutation(
							{
								organizationId: validatedData.organizationId,
								userIds: [validatedData.userId],
							},
							(tx) =>
								tx
									.insert(employee)
									.values({
										userId: validatedData.userId,
										organizationId: validatedData.organizationId,
										teamId: validatedData.teamId || null,
										role: validatedData.role,
										position: validatedData.position || null,
										gender: validatedData.gender || null,
										pronouns: validatedData.pronouns || null,
										birthday: validatedData.birthday || null,
										startDate: validatedData.startDate || null,
										endDate: validatedData.endDate || null,
										isActive: true,
										contractType: validatedData.contractType || "fixed",
										currentHourlyRate: hourlyRateValue?.toString() || null,
									})
									.returning(),
							dbService.db,
						),
					)
					.pipe(
						Effect.mapError((error) =>
							isEmployeeIdentityConflict(error)
								? new ValidationError({
										message:
											"Employee already exists for this user in this organization",
										field: "userId",
									})
								: error,
						),
					);

				if (
					validatedData.contractType === "hourly" &&
					validatedData.hourlyRate &&
					hourlyRateValue
				) {
					yield* dbService.query("createInitialRateHistory", async () => {
						await dbService.db.insert(employeeRateHistory).values({
							employeeId: newEmployee.id,
							organizationId: validatedData.organizationId,
							hourlyRate: hourlyRateValue.toString(),
							currency: "EUR",
							effectiveFrom: new Date(),
							effectiveTo: null,
							reason: "Initial rate",
							createdBy: session.user.id,
						});
					});
				}

				logger.info(
					{
						employeeId: newEmployee.id,
						userId: newEmployee.userId,
						organizationId: newEmployee.organizationId,
					},
					"Employee created successfully",
				);

				revalidateEmployeesCache(newEmployee.organizationId);
				span.setAttribute("employee.id", newEmployee.id);

				return newEmployee;
			}),
	});
}

/**
 * Saves the employee detail form. `customFieldValues` are the form's custom
 * field values (#818): written in the same transaction, refused above the
 * actor's edit level, and every required field the actor may edit must have a
 * value afterwards.
 */
export async function updateEmployeeAction(
	employeeId: string,
	data: UpdateEmployee,
	customFieldValues?: CustomFieldValuesInput,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateEmployee",
		attributes: {
			"employee.id": employeeId,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to update employee");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "updateEmployeeAction:actor" });
				const { session, dbService } = actor;

				const inputData: UpdateEmployee =
					actor.accessTier === "manager"
						? (filterEmployeeUpdateForScopedManager(data) as UpdateEmployee)
						: data;
				const validatedData = yield* validateInput(updateEmployeeSchema, inputData);
				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee",
					resource: "employee",
					action: "update",
				});

				const scopedData: UpdateEmployee = validatedData;

				const newHourlyRate = parseHourlyRate(
					"hourlyRate" in scopedData
						? (scopedData.hourlyRate as string | null | undefined)
						: undefined,
				);
				const currentRate = parseHourlyRate(targetEmployee.currentHourlyRate);

				const { hourlyRate: _hourlyRate, ...updateData } = scopedData;
				const updatePayload = {
					...updateData,
					currentHourlyRate: newHourlyRate?.toString() || null,
					updatedAt: currentTimestamp(),
				};

				const {
					firstName,
					lastName,
					...employeeUpdateData
				} = updatePayload as typeof updatePayload & {
					firstName?: string;
					lastName?: string;
				};

				// Role, team and active state feed creation authority and target checks.
				yield* dbService
					.query("updateEmployee", () =>
						withAuthorizationMutation(
							{
								organizationId: targetEmployee.organizationId,
								employeeIds: [employeeId],
							},
							async (tx) => {
								await tx
									.update(employee)
									.set(employeeUpdateData)
									.where(
										and(
											eq(employee.id, employeeId),
											eq(employee.organizationId, targetEmployee.organizationId),
										),
									);
								await saveFormCustomFieldValues(tx, {
									organizationId: targetEmployee.organizationId,
									actorUserId: session.user.id,
									entity: "employee",
									recordId: employeeId,
									values: customFieldValues,
								});
							},
							dbService.db,
						),
					)
					.pipe(keepCustomFieldRefusal);

				if (
					actor.accessTier === "orgAdmin" &&
					(firstName !== undefined || lastName !== undefined)
				) {
					const nextFirstName =
						firstName ?? targetEmployee.user?.firstName ?? "";
					const nextLastName = lastName ?? targetEmployee.user?.lastName ?? "";
					const authName = toAuthStructuredName({
						firstName: nextFirstName,
						lastName: nextLastName,
						fallbackName: targetEmployee.user?.name ?? undefined,
					});

					yield* dbService.query("updateEmployeeAuthUserName", async () => {
						await dbService.db
							.update(user)
							.set({
								...authName,
								updatedAt: new Date(),
							})
							.where(eq(user.id, targetEmployee.userId));
					});
				}

				const previousStartDate = dateToUtcIsoDate(targetEmployee.startDate);
				const hasStartDateUpdate =
					Object.hasOwn(scopedData, "startDate") &&
					scopedData.startDate !== undefined;
				const nextStartDate = hasStartDateUpdate
					? dateToUtcIsoDate(scopedData.startDate)
					: previousStartDate;
				if (nextStartDate !== previousStartDate) {
					if (previousStartDate && !nextStartDate) {
						yield* Effect.promise(() =>
							requestEmployeeWorkBalanceFullRebuild({
								employeeId,
								organizationId: targetEmployee.organizationId,
							}),
						);
					} else {
						const startDates = [previousStartDate, nextStartDate].filter(
							(value): value is string => Boolean(value),
						);
						const dirtyFromDate = startDates.reduce((earliest, value) =>
							value < earliest ? value : earliest,
						);
						yield* Effect.promise(() =>
							markEmployeeWorkBalanceDirty({
								employeeId,
								organizationId: targetEmployee.organizationId,
								dirtyFromDate,
							}),
						);
					}
				}

				const effectiveContractType =
					("contractType" in scopedData
						? scopedData.contractType
						: undefined) ?? targetEmployee.contractType;
				if (
					effectiveContractType === "hourly" &&
					newHourlyRate !== null &&
					newHourlyRate !== currentRate
				) {
					yield* dbService.query("closeActiveRateHistory", async () => {
						await dbService.db
							.update(employeeRateHistory)
							.set({ effectiveTo: new Date() })
							.where(
								and(
									eq(employeeRateHistory.employeeId, employeeId),
									isNull(employeeRateHistory.effectiveTo),
								),
							);
					});

					yield* dbService.query("createRateHistoryEntry", async () => {
						await dbService.db.insert(employeeRateHistory).values({
							employeeId,
							organizationId: targetEmployee.organizationId,
							hourlyRate: newHourlyRate.toString(),
							currency: "EUR",
							effectiveFrom: new Date(),
							effectiveTo: null,
							reason: "Rate updated",
							createdBy: session.user.id,
						});
					});

					logger.info(
						{
							employeeId,
							previousRate: currentRate,
							newRate: newHourlyRate,
						},
						"Employee rate history created",
					);
				}

				logger.info({ employeeId }, "Employee updated successfully");
				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}

export async function updateEmployeeInvitationDraftAction(
	draftEmployeeId: string,
	data: UpdateEmployeeInvitationDraft,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateEmployeeInvitationDraft",
		attributes: { "employeeDraft.id": draftEmployeeId },
		logError: (error) => {
			logger.error(
				{ error, draftEmployeeId },
				"Failed to update employee invitation draft",
			);
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "updateEmployeeInvitationDraftAction:actor" });
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message:
						"Only organization admins can update invited employee drafts",
					resource: "employee_invitation_draft",
					action: "update",
				});

				const draftId =
					decodeEmployeeInvitationDraftId(draftEmployeeId) ?? draftEmployeeId;
				const validatedData = yield* validateInput(updateEmployeeInvitationDraftSchema, data);
				const targetDraft = yield* actor.dbService.query(
					"getEmployeeInvitationDraftForUpdate",
					async () => {
						const rows = await actor.dbService.db
							.select({
								id: employeeInvitationDraft.id,
								normalizedEmail: employeeInvitationDraft.normalizedEmail,
							})
							.from(employeeInvitationDraft)
							.where(
								and(
									eq(employeeInvitationDraft.id, draftId),
									eq(
										employeeInvitationDraft.organizationId,
										actor.organizationId,
									),
								),
							)
							.limit(1);

						return rows[0] ?? null;
					},
				);

				if (!targetDraft) {
					return yield* Effect.fail(
						new ValidationError({
							message: "This invitation draft can no longer be edited",
							field: "draftEmployeeId",
							value: draftEmployeeId,
						}),
					);
				}

				if (validatedData.teamId) {
					const targetTeamId = validatedData.teamId;
					const targetTeam = yield* actor.dbService.query(
						"getEmployeeInvitationDraftTeam",
						async () => {
							return await actor.dbService.db.query.team.findFirst({
								where: and(
									eq(team.id, targetTeamId),
									eq(team.organizationId, actor.organizationId),
								),
							});
						},
					);

					if (!targetTeam) {
						return yield* Effect.fail(
							new ValidationError({
								message: "Target team not found in this organization",
								field: "teamId",
								value: targetTeamId,
							}),
						);
					}
				}

				const hasHourlyRateUpdate = Object.hasOwn(validatedData, "hourlyRate");
				const hasTeamIdUpdate = Object.hasOwn(validatedData, "teamId");
				const hourlyRate = hasHourlyRateUpdate
					? parseHourlyRate(validatedData.hourlyRate)
					: null;
				const { hourlyRate: _hourlyRate, ...draftUpdate } = validatedData;
				const updatedDrafts = yield* actor.dbService.query("updateEmployeeInvitationDraft", async () => {
					return await actor.dbService.db.transaction(
						async (tx) => {
							await acquireEmployeeIdentityLock(tx, {
								organizationId: actor.organizationId,
								normalizedEmail: targetDraft.normalizedEmail,
							});

							const [lockedDraft] = await tx
								.select({
									id: employeeInvitationDraft.id,
									invitationId: employeeInvitationDraft.invitationId,
								})
								.from(employeeInvitationDraft)
								.where(
									and(
										eq(employeeInvitationDraft.id, draftId),
										eq(
											employeeInvitationDraft.organizationId,
											actor.organizationId,
										),
									),
								)
								.for("update");

							if (!lockedDraft) return [];

							const [lockedInvitation] = await tx
								.select({ id: invitation.id })
								.from(invitation)
								.where(
									and(
										eq(invitation.id, lockedDraft.invitationId),
										eq(invitation.organizationId, actor.organizationId),
									),
								)
								.for("update");

							if (!lockedInvitation) return [];

							const now = dateFromInstant(systemClock.nowInstant());
							const [eligibleDraft] = await tx
								.select({ id: employeeInvitationDraft.id })
								.from(employeeInvitationDraft)
								.innerJoin(
									invitation,
									eq(employeeInvitationDraft.invitationId, invitation.id),
								)
								.where(
									and(
										buildEligibleInvitationDraftPredicate({
											organizationId: actor.organizationId,
											now,
											draftId,
										}),
										eq(
											employeeInvitationDraft.invitationId,
											lockedDraft.invitationId,
										),
										eq(invitation.id, lockedDraft.invitationId),
									),
								)
								.limit(1);

							if (!eligibleDraft) return [];

							const updatedDrafts = await tx
								.update(employeeInvitationDraft)
								.set({
									...draftUpdate,
									...(hasHourlyRateUpdate
										? { currentHourlyRate: hourlyRate?.toString() ?? null }
										: {}),
									updatedBy: actor.session.user.id,
									updatedAt: currentTimestamp(),
								})
								.where(
									and(
										eq(employeeInvitationDraft.id, draftId),
										eq(
											employeeInvitationDraft.organizationId,
											actor.organizationId,
										),
									),
								)
								.returning({ id: employeeInvitationDraft.id });
							if (updatedDrafts.length === 0 || !hasTeamIdUpdate) {
								return updatedDrafts;
							}

							await tx
								.update(invitation)
								.set({ targetTeamId: validatedData.teamId ?? null })
								.where(
									and(
										eq(invitation.id, lockedInvitation.id),
										eq(invitation.organizationId, actor.organizationId),
										eq(invitation.status, "pending"),
									),
								);

							return updatedDrafts;
						},
						{ isolationLevel: "serializable" },
					);
				});

				if (updatedDrafts.length === 0) {
					return yield* Effect.fail(
						new ValidationError({
							message: "This invitation draft can no longer be edited",
							field: "draftEmployeeId",
							value: draftEmployeeId,
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}

export async function deleteEmployeeInvitationDraftAction(
	draftEmployeeId: string,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "deleteEmployeeInvitationDraft",
		attributes: { "employeeDraft.id": draftEmployeeId },
		logError: (error) => {
			logger.error(
				{ error, draftEmployeeId },
				"Failed to delete employee invitation draft",
			);
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteEmployeeInvitationDraftAction:actor" });
				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message:
						"Only organization admins can delete invited employee drafts",
					resource: "employee_invitation_draft",
					action: "delete",
				});

				const draftId =
					decodeEmployeeInvitationDraftId(draftEmployeeId) ?? draftEmployeeId;
				const outcome = yield* actor.dbService.query("deleteEmployeeInvitationDraft", async () => {
					return await actor.dbService.db.transaction(async (tx) => {
						const [draftIdentity] = await tx
							.select({
								normalizedEmail: employeeInvitationDraft.normalizedEmail,
							})
							.from(employeeInvitationDraft)
							.where(
								and(
									eq(employeeInvitationDraft.id, draftId),
									eq(
										employeeInvitationDraft.organizationId,
										actor.organizationId,
									),
								),
							)
							.limit(1);

						if (!draftIdentity) return "notFound" as const;

						await acquireEmployeeIdentityLock(tx, {
							organizationId: actor.organizationId,
							normalizedEmail: draftIdentity.normalizedEmail,
						});

						const [lockedDraft] = await tx
							.select({
								id: employeeInvitationDraft.id,
								invitationId: employeeInvitationDraft.invitationId,
								normalizedEmail: employeeInvitationDraft.normalizedEmail,
								invitationStatus: invitation.status,
								invitationExpiresAt: invitation.expiresAt,
							})
							.from(employeeInvitationDraft)
							.innerJoin(
								invitation,
								eq(employeeInvitationDraft.invitationId, invitation.id),
							)
							.where(
								and(
									eq(employeeInvitationDraft.id, draftId),
									eq(
										employeeInvitationDraft.organizationId,
										actor.organizationId,
									),
									eq(invitation.organizationId, actor.organizationId),
								),
							)
							.limit(1)
							.for("update", { of: employeeInvitationDraft });

						if (
							!lockedDraft ||
							lockedDraft.normalizedEmail !== draftIdentity.normalizedEmail
						) {
							return "notFound" as const;
						}

						const [existingEmployee] = await tx
							.select({ id: employee.id })
							.from(employee)
							.innerJoin(user, eq(employee.userId, user.id))
							.where(
								and(
									eq(employee.organizationId, actor.organizationId),
									sql`lower(btrim(${user.email})) = ${lockedDraft.normalizedEmail}`,
								),
							)
							.limit(1);

						if (existingEmployee) return "employeeExists" as const;
						if (lockedDraft.invitationStatus === "accepted")
							return "accepted" as const;

						const actionable = isInvitationActionable({
							status: lockedDraft.invitationStatus,
							expiresAt: lockedDraft.invitationExpiresAt,
						});
						if (actionable) {
							const cancellationNow = dateFromInstant(
								systemClock.nowInstant(),
							);
							const canceledInvitations = await tx
								.update(invitation)
								.set({ status: "canceled" })
								.where(
									and(
										eq(invitation.id, lockedDraft.invitationId),
										eq(invitation.organizationId, actor.organizationId),
										eq(invitation.status, "pending"),
										gt(invitation.expiresAt, cancellationNow),
									),
								)
								.returning({ id: invitation.id });

							if (canceledInvitations.length === 0) {
								const [currentDraft] = await tx
									.select({
										invitationId: employeeInvitationDraft.invitationId,
									})
									.from(employeeInvitationDraft)
									.where(
										and(
											eq(employeeInvitationDraft.id, draftId),
											eq(
												employeeInvitationDraft.organizationId,
												actor.organizationId,
											),
										),
									)
									.limit(1);

								if (currentDraft?.invitationId !== lockedDraft.invitationId) {
									return "cancellationFailed" as const;
								}

								const [currentInvitation] = await tx
									.select({
										status: invitation.status,
										expiresAt: invitation.expiresAt,
									})
									.from(invitation)
									.where(
										and(
											eq(invitation.id, lockedDraft.invitationId),
											eq(invitation.organizationId, actor.organizationId),
										),
									)
									.for("update");

								if (
									!currentInvitation ||
									currentInvitation.status === "accepted"
								) {
									return "cancellationFailed" as const;
								}

								const becameStale =
									currentInvitation.status === "canceled" ||
									currentInvitation.status === "rejected" ||
									(currentInvitation.status === "pending" &&
										!isInvitationActionable(currentInvitation));
								if (!becameStale) return "cancellationFailed" as const;
							}
						} else {
							const [currentInvitation] = await tx
								.select({
									status: invitation.status,
									expiresAt: invitation.expiresAt,
								})
								.from(invitation)
								.where(
									and(
										eq(invitation.id, lockedDraft.invitationId),
										eq(invitation.organizationId, actor.organizationId),
									),
								)
								.for("update");

							if (!currentInvitation) return "raceLost" as const;

							const isStillStale =
								currentInvitation.status === "canceled" ||
								currentInvitation.status === "rejected" ||
								(currentInvitation.status === "pending" &&
									!isInvitationActionable(currentInvitation));
							if (!isStillStale) return "raceLost" as const;
						}

						const deletedDrafts = await tx
							.delete(employeeInvitationDraft)
							.where(
								and(
									eq(employeeInvitationDraft.id, draftId),
									eq(
										employeeInvitationDraft.organizationId,
										actor.organizationId,
									),
									eq(
										employeeInvitationDraft.invitationId,
										lockedDraft.invitationId,
									),
								),
							)
							.returning({ id: employeeInvitationDraft.id });

						return deletedDrafts.length === 1
							? ("deleted" as const)
							: ("raceLost" as const);
					});
				});

				if (outcome === "cancellationFailed") {
					return yield* Effect.fail(
						new ValidationError({
							message: invitationCancellationFailureMessage,
							field: "draftEmployeeId",
						}),
					);
				}
				if (outcome === "employeeExists") {
					return yield* Effect.fail(
						new ValidationError({
							message:
								"This invitation draft is already associated with an employee",
							field: "draftEmployeeId",
						}),
					);
				}
				if (outcome !== "deleted") {
					return yield* Effect.fail(
						new ValidationError({
							message: "This invitation draft can no longer be deleted",
							field: "draftEmployeeId",
						}),
					);
				}

				revalidateEmployeesCache(actor.organizationId);
			}),
	});
}

export async function requestEmployeeWorkBalanceRecalculationAction(
	employeeId: string,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "requestEmployeeWorkBalanceRecalculation",
		logError: (error) => {
			logger.error(
				{ error },
				"Failed to request employee work balance recalculation",
			);
		},
		execute: (span) =>
			Effect.gen(function* () {
				const validatedEmployeeId = yield* validateInput(employeeIdSchema, employeeId, "employeeId");
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "requestEmployeeWorkBalanceRecalculationAction:actor" });
				const { dbService } = actor;

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message:
						"Only organization admins can recalculate employee work balances",
					resource: "employee_work_balance",
					action: "recalculate_work_balance",
				});

				const targetEmployee = yield* dbService.query(
					"getEmployeeForWorkBalanceRecalculation",
					async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, validatedEmployeeId),
								eq(employee.organizationId, actor.organizationId),
							),
							columns: {
								id: true,
								organizationId: true,
							},
						});
					},
				);

				if (!targetEmployee) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: validatedEmployeeId,
						}),
					);
				}

				span.setAttribute("employee.id", targetEmployee.id);
				span.setAttribute(
					"employee.organizationId",
					targetEmployee.organizationId,
				);
				span.setAttribute("requestedBy.userId", actor.session.user.id);

				yield* Effect.promise(() =>
					requestEmployeeWorkBalanceFullRebuild({
						employeeId: targetEmployee.id,
						organizationId: targetEmployee.organizationId,
					}),
				);

				logger.info(
					{
						employeeId: targetEmployee.id,
						organizationId: targetEmployee.organizationId,
						requestedBy: actor.session.user.id,
					},
					"Employee work balance recalculation requested",
				);
			}),
	});
}

function dateToUtcIsoDate(
	value: Date | string | null | undefined,
): string | null {
	if (!value) return null;
	return (
		typeof value === "string"
			? DateTime.fromISO(value, { zone: "utc" })
			: DateTime.fromJSDate(value, { zone: "utc" })
	).toISODate();
}

export async function updateOwnProfileAction(
	data: PersonalInformation,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "updateOwnProfile",
		logError: (error) => {
			logger.error({ error }, "Failed to update own profile");
		},
		execute: (span) =>
			Effect.gen(function* () {
				const { dbService, currentEmployee } = yield* getEmployeeContext();
				span.setAttribute("employee.id", currentEmployee.id);

				const validatedData = yield* validateInput(personalInformationSchema, data, "profile");
				const {
					firstName: _firstName,
					lastName: _lastName,
					...employeeProfileData
				} = validatedData;

				yield* dbService.query("updateOwnProfile", async () => {
					await dbService.db
						.update(employee)
						.set({
							...employeeProfileData,
							updatedAt: currentTimestamp(),
						})
						.where(eq(employee.id, currentEmployee.id));
				});

				logger.info(
					{ employeeId: currentEmployee.id },
					"Profile updated successfully",
				);
			}),
	});
}

export async function assignManagersAction(
	employeeId: string,
	data: AssignManagers,
): Promise<ServerActionResult<void>> {
	return runTracedEmployeeAction({
		name: "assignManagers",
		attributes: {
			"employee.id": employeeId,
			"managers.count": data.managers.length,
		},
		logError: (error) => {
			logger.error({ error, employeeId }, "Failed to assign managers");
		},
		execute: () =>
			Effect.gen(function* () {
				const actor = yield* getEmployeeSettingsActorContext({ queryName: "assignManagersAction:actor" });
				const managerService = yield* ManagerService;
				const targetEmployee = yield* getTargetEmployee(employeeId);

				yield* requireOrgAdminEmployeeSettingsAccess(actor, {
					message: "Only organization admins can assign managers",
					resource: "manager_assignment",
					action: "create",
				});

				yield* ensureSettingsActorCanAccessEmployeeTarget(actor, targetEmployee, {
					message: "You do not have access to this employee",
					resource: "manager_assignment",
					action: "create",
				});

				const validatedData = yield* validateInput(assignManagersSchema, data);
				const existingManagers = yield* managerService.getManagers(employeeId);

				for (const existingManager of existingManagers) {
					if (
						validatedData.managers.some(
							(manager) => manager.managerId === existingManager.id,
						)
					) {
						continue;
					}

					if (existingManagers.length > 1) {
						yield* managerService.removeManager(employeeId, existingManager.id);
					}
				}

				for (const assignment of validatedData.managers) {
					yield* managerService.assignManager(
						employeeId,
						assignment.managerId,
						assignment.isPrimary,
						actor.session.user.id,
					);
				}

				logger.info(
					{
						employeeId,
						managerCount: validatedData.managers.length,
					},
					"Managers assigned successfully",
				);
			}),
	});
}
