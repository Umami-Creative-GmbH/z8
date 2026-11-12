"use server";

import { and, eq, gt, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { z } from "zod";
import { invitation, user } from "@/db/auth-schema";
import { employee, employeeInvitationDraft, team } from "@/db/schema";
import { AuditAction, type AuditLogEntry, logAudit } from "@/lib/audit-logger";
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
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { writeFirstEmploymentTerms } from "@/lib/employment-history/first-terms";
import { createLogger } from "@/lib/logger";
import {
	keepCustomFieldRefusal,
	saveFormCustomFieldValues,
} from "@/lib/organization/custom-fields/form-values";
import type { CustomFieldValuesInput } from "@/lib/organization/custom-fields/value-rules";
import {
	previewDrivingLicenceIntendedDriverWrite,
	runDrivingLicenceIntendedDriverWrite,
} from "@/lib/organization/driving-licence/no-longer-intended";
import { keepDrivingLicenceStalePreview } from "@/lib/organization/driving-licence/stale-preview";
import { type BirthdayChange, birthdayChange } from "@/lib/organization/employee-birthday";
import { personnelNumberKey } from "@/lib/organization/personnel-number";
import {
	assertPersonnelNumberFree,
	assertPersonnelNumberLocallyEditable,
	findPersonnelNumberHolder,
	keepPersonnelNumberRefusal,
} from "@/lib/organization/personnel-number-uniqueness";
import { keepPrimaryTeamRefusal, setPrimaryTeam } from "@/lib/organization/primary-team";
import {
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { revokeShareLinksAfterAccessChange } from "@/lib/projects/report-share/access-change";
import { pauseSchedulesAfterOwnerAccessChange } from "@/lib/scheduled-exports/application/owner-access-change";
import {
	assignManagersSchema,
	type ContractType,
	createEmployeeSchema,
	personalInformationSchema,
	type UpdateEmployee,
	updateEmployeeInvitationDraftSchema,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import { hourlyWageSchema } from "@/lib/validations/employment-history";
import {
	markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild,
} from "@/lib/work-balance/service";
import { decodeEmployeeInvitationDraftId } from "./employee-action-types";
import { getTargetUser, parseHourlyRate, revalidateEmployeesCache } from "./employee-action-utils";
import { buildEligibleInvitationDraftPredicate } from "./employee-invitation-draft-eligibility";
import { filterEmployeeUpdateForScopedManager } from "./employee-scope";
import { keepTermsRefusal, markContractWorkBalanceDirty } from "./employment-history-helpers";
import {
	findDraftPersonnelNumberHolder,
	refuseTakenDraftPersonnelNumber,
} from "./invitation-draft-personnel-number";
import { loadManagedEmployee } from "./managed-employee";

const logger = createLogger("EmployeeActions");
const employeeIdSchema = z.uuid("Invalid employee ID");
const draftEmployeeIdSchema = z.string().min(1, "Invalid invitation draft");
const invitationCancellationFailureMessage =
	"The pending invitation could not be canceled. The employee draft was kept.";

/** The employee detail form's values: checked against `updateEmployeeSchema` once scoped. */
const employeeFormDataSchema = z
	.record(z.string(), z.unknown())
	// The edit form never switches an employee on or off: a stale client or a crafted
	// request is refused, not silently ignored (#1439).
	.refine((data) => !Object.hasOwn(data, "isActive"), {
		message: "Use Deactivate or Reactivate to change whether an employee is active.",
		path: ["isActive"],
	});

/** An hourly employee's wage, as employment terms hold it; null otherwise. */
function parseFirstTermsWage(
	contractType: ContractType,
	hourlyRate: string | null | undefined,
): Effect.Effect<number | null, ValidationError> {
	if (contractType !== "hourly" || !hourlyRate) return Effect.succeed(null);
	const parsed = hourlyWageSchema.safeParse(hourlyRate);
	return parsed.success
		? Effect.succeed(parsed.data)
		: Effect.fail(
				new ValidationError({
					message: parsed.error.issues[0]?.message ?? "Invalid hourly rate",
					field: "hourlyRate",
				}),
			);
}

/**
 * Records that an org admin set, changed or cleared a birthday (#1579). The
 * dates stay out of the audit log: it must not hold another copy of them.
 */
function recordBirthdayChange(entry: {
	organizationId: string;
	target: Pick<AuditLogEntry, "targetType" | "targetId" | "employeeId">;
	change: BirthdayChange;
}) {
	return Effect.gen(function* () {
		const session = yield* (yield* AuthService).getSession();
		yield* Effect.promise(() =>
			logAudit({
				action: AuditAction.EMPLOYEE_UPDATED,
				actorId: session.user.id,
				actorEmail: session.user.email,
				organizationId: entry.organizationId,
				...entry.target,
				metadata: { field: "birthday", change: entry.change },
				timestamp: dateFromInstant(systemClock.nowInstant()),
			}),
		);
	});
}

/** Org admins and owners; a scoped manager saves only some employee fields. */
function isOrgAdmin(actor: OrganizationActor) {
	return meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
}

export const createEmployeeAction = organizationAction(
	{
		name: "employees.create",
		requires: "orgAdmin",
		// The organization is the session's (ADR 0002).
		schema: createEmployeeSchema.omit({ organizationId: true }),
	},
	({ actor, organizationId, input: validatedData }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			yield* getTargetUser(validatedData.userId);

			const existing = yield* dbService.query("checkExistingEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, validatedData.userId),
						eq(employee.organizationId, organizationId),
					),
				});
			});

			if (existing) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Employee already exists for this user in this organization",
						field: "userId",
					}),
				);
			}

			const contractType = validatedData.contractType || "fixed";
			const hourlyRate = yield* parseFirstTermsWage(contractType, validatedData.hourlyRate);

			const { newEmployee, firstTerms } = yield* dbService
				.query("createEmployee", () =>
					// A new employee row gives the user an employee role and team in
					// the organization: an absent-row insertion under their protection.
					withAuthorizationMutation(
						{ organizationId, userIds: [validatedData.userId] },
						async (tx) => {
							const [inserted] = await tx
								.insert(employee)
								.values({
									userId: validatedData.userId,
									organizationId,
									role: validatedData.role,
									position: validatedData.position || null,
									gender: validatedData.gender || null,
									pronouns: validatedData.pronouns || null,
									birthday: validatedData.birthday || null,
									startDate: validatedData.startDate || null,
									endDate: validatedData.endDate || null,
									isActive: true,
									contractType,
								})
								.returning();
							// The team is a membership and the primary team (Organization ADR 0010).
							const placed = validatedData.teamId
								? await setPrimaryTeam(tx, {
										organizationId,
										employeeId: inserted.id,
										teamId: validatedData.teamId,
										createdBy: actor.userId,
									})
								: null;
							// The wage lives in employment terms (Organization ADR 0002):
							// an hourly employee starts with confirmed terms, and
							// without them no employee is created.
							const terms = await writeFirstEmploymentTerms(tx, {
								organizationId,
								employeeId: inserted.id,
								actorUserId: actor.userId,
								contractType,
								hourlyRate,
								startDate: validatedData.startDate ?? null,
							});
							return {
								newEmployee: { ...inserted, teamId: placed?.primaryTeamId ?? null },
								firstTerms: terms,
							};
						},
						dbService.db,
					),
				)
				.pipe(
					Effect.mapError((error) => {
						if (isEmployeeIdentityConflict(error)) {
							return new ValidationError({
								message: "Employee already exists for this user in this organization",
								field: "userId",
							});
						}
						// Keep the terms refusal for the user (D8).
						return keepTermsRefusal(error);
					}),
					keepPrimaryTeamRefusal,
				);

			if (firstTerms) {
				yield* Effect.promise(() =>
					markContractWorkBalanceDirty(dbService.db, {
						employeeId: newEmployee.id,
						organizationId: newEmployee.organizationId,
						validFrom: firstTerms.validFrom,
					}),
				);
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

			return newEmployee;
		}),
);

/**
 * What of `data` the actor may save on the employee (scoped managers only some
 * fields), and the employee, loaded within the actor's managed scope. Shared by
 * `updateEmployeeAction` and its driving licence preview.
 */
function scopedEmployeeUpdate(
	context: { actor: OrganizationActor; organizationId: string },
	employeeId: string,
	data: Record<string, unknown>,
) {
	return Effect.gen(function* () {
		const parsed = updateEmployeeSchema.safeParse(
			isOrgAdmin(context.actor) ? data : filterEmployeeUpdateForScopedManager(data),
		);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return yield* Effect.fail(
				new ValidationError({
					message: issue?.message ?? "Invalid input",
					field: issue?.path.join(".") || "data",
				}),
			);
		}
		const targetEmployee = yield* loadManagedEmployee(context, employeeId, {
			queryName: "updateEmployee:target",
		});
		return { validatedData: parsed.data as UpdateEmployee, targetEmployee };
	});
}

/**
 * The warning before saving a new primary team on the employee (#1425): what the actor may
 * see of the driving authorizations that would end, and the token `updateEmployeeAction`
 * takes. Read-only; authorized exactly like the save.
 */
export const previewEmployeeTeamChangeDrivingImpact = organizationAction(
	{
		name: "employees.previewTeamChangeDrivingImpact",
		requires: "scopedManager",
		schema: z.strictObject({
			employeeId: employeeIdSchema,
			teamId: z.uuid("Invalid team ID").nullable(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employeeId } = input;
			const { validatedData } = yield* scopedEmployeeUpdate({ actor, organizationId }, employeeId, {
				teamId: input.teamId,
			});
			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("employee.previewTeamChangeDrivingImpact", () =>
					previewDrivingLicenceIntendedDriverWrite<TeamWriteTransaction>(
						{
							organizationId,
							employeeIds: [employeeId],
							viewer: { userId: actor.userId, organizationAdmin: isOrgAdmin(actor) },
						},
						(work) =>
							withAuthorizationMutation(
								{ organizationId, employeeIds: [employeeId] },
								work,
								dbService.db,
							),
						async (tx) => {
							// A scoped manager can't change the team: nothing changes then.
							if (!Object.hasOwn(validatedData, "teamId")) return;
							await setPrimaryTeam(tx, {
								organizationId,
								employeeId,
								teamId: validatedData.teamId ?? null,
							});
						},
					),
				)
				.pipe(keepPrimaryTeamRefusal);
		}),
);

type TeamWriteTransaction = Parameters<Parameters<typeof withAuthorizationMutation>[1]>[0];

/**
 * Saves the employee detail form. `customFieldValues` are the form's custom
 * field values (#818): written in the same transaction, refused above the
 * actor's edit level, and every required field the actor may edit must have a
 * value afterwards. A new primary team must match its confirmed driving licence
 * warning (`drivingLicencePreviewToken`, #1425); without one it may end nothing.
 */
export const updateEmployeeAction = organizationAction(
	{
		name: "employees.update",
		requires: "scopedManager",
		schema: z.strictObject({
			employeeId: employeeIdSchema,
			data: employeeFormDataSchema,
			customFieldValues: z.record(z.string(), z.unknown()).optional(),
			drivingLicencePreviewToken: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employeeId } = input;
			const customFieldValues = input.customFieldValues as CustomFieldValuesInput | undefined;
			const { validatedData, targetEmployee } = yield* scopedEmployeeUpdate(
				{ actor, organizationId },
				employeeId,
				input.data,
			);
			const dbService = yield* DatabaseService;

			const scopedData: UpdateEmployee = validatedData;

			// Contract type and wage change only through employment terms
			// (Organization ADR 0002); the schema carries neither.
			const updatePayload = {
				...scopedData,
				updatedAt: currentTimestamp(),
			};

			const {
				firstName,
				lastName,
				teamId: nextTeamId,
				...employeeUpdateData
			} = updatePayload as typeof updatePayload & {
				firstName?: string;
				lastName?: string;
			};
			// A changed Team field is a move (Organization ADR 0010).
			const hasTeamUpdate = nextTeamId !== undefined;

			// A personnel number is unique per organization among current and former
			// employees (#881); a blank one is no number.
			const personnelNumber =
				typeof employeeUpdateData.employeeNumber === "string"
					? employeeUpdateData.employeeNumber
					: null;
			const personnelNumberScope = { organizationId, exceptEmployeeId: employeeId };

			// Role, team and active state feed creation authority and target checks.
			const birthdayUpdate = yield* dbService
				.query("updateEmployee", () =>
					withAuthorizationMutation(
						{ organizationId, employeeIds: [employeeId] },
						async (tx) => {
							// Actual joining dates require a reviewed correction. Recheck under the employee guard,
							// including stale full-form payloads that would otherwise undo a reviewed save.
							if (Object.hasOwn(scopedData, "startDate") && scopedData.startDate !== undefined) {
								const [current] = await tx
									.select({ startDate: employee.startDate })
									.from(employee)
									.where(
										and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
									);
								if (
									!current ||
									dateToUtcIsoDate(scopedData.startDate) !== dateToUtcIsoDate(current.startDate)
								) {
									throw new ValidationError({
										message: "Review the actual employment start correction before saving it.",
										field: "startDate",
									});
								}
							}
							await assertPersonnelNumberLocallyEditable(tx, {
								organizationId,
								employeeId,
								personnelNumber: employeeUpdateData.employeeNumber,
							});
							if (personnelNumber !== null) {
								await assertPersonnelNumberFree(tx, { ...personnelNumberScope, personnelNumber });
							}
							// What this save replaces, locked so the audit records the real change (#1579).
							// A scoped manager's save carries no birthday.
							let birthdayUpdate: BirthdayChange | null = null;
							if (scopedData.birthday !== undefined) {
								const [stored] = await tx
									.select({ birthday: employee.birthday })
									.from(employee)
									.where(
										and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
									)
									.for("update");
								birthdayUpdate = birthdayChange(stored?.birthday, scopedData.birthday);
							}
							const writeEmployee = async () => {
								await tx
									.update(employee)
									.set(employeeUpdateData)
									.where(
										and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
									);
								if (hasTeamUpdate) {
									await setPrimaryTeam(tx, {
										organizationId,
										employeeId,
										teamId: nextTeamId ?? null,
										createdBy: actor.userId,
									});
								}
							};
							// A new primary team can end the employee's driving authorization (#1425).
							if (hasTeamUpdate)
								await runDrivingLicenceIntendedDriverWrite(
									tx,
									{
										organizationId,
										employeeIds: [employeeId],
										actorUserId: actor.userId,
										viewer: { userId: actor.userId, organizationAdmin: isOrgAdmin(actor) },
										previewToken: input.drivingLicencePreviewToken,
									},
									writeEmployee,
								);
							else await writeEmployee();
							await saveFormCustomFieldValues(tx, {
								organizationId,
								actorUserId: actor.userId,
								entity: "employee",
								recordId: employeeId,
								values: customFieldValues,
							});
							return birthdayUpdate;
						},
						dbService.db,
					),
				)
				.pipe(
					keepCustomFieldRefusal,
					keepDrivingLicenceStalePreview,
					keepPrimaryTeamRefusal,
					// A concurrent save that took the number first hits the unique index.
					keepPersonnelNumberRefusal(() =>
						personnelNumber === null
							? Effect.succeed(null)
							: dbService.query("updateEmployee:personnelNumberHolder", () =>
									findPersonnelNumberHolder(dbService.db, {
										...personnelNumberScope,
										personnelNumber,
									}),
								),
					),
				);

			if (birthdayUpdate) {
				yield* recordBirthdayChange({
					organizationId,
					target: { targetType: "employee", targetId: employeeId, employeeId },
					change: birthdayUpdate,
				});
			}

			// A lower role can take projects away from the employee's share links (#806).
			if ("role" in employeeUpdateData) {
				yield* dbService.query("reportShareLink.revokeAfterEmployeeUpdate", () =>
					revokeShareLinksAfterAccessChange(dbService.db, {
						organizationId,
						creator: { employeeId },
						actorUserId: actor.userId,
					}),
				);
				// A deactivated owner or admin can no longer own scheduled exports (#988).
				yield* dbService.query("scheduledExport.pauseAfterEmployeeUpdate", () =>
					pauseSchedulesAfterOwnerAccessChange(dbService.db, {
						organizationId,
						owner: { employeeId },
						actorUserId: actor.userId,
					}),
				);
			}

			if (isOrgAdmin(actor) && (firstName !== undefined || lastName !== undefined)) {
				const nextFirstName = firstName ?? targetEmployee.user?.firstName ?? "";
				const nextLastName = lastName ?? targetEmployee.user?.lastName ?? "";
				const authName = toAuthStructuredName({
					firstName: nextFirstName,
					lastName: nextLastName,
					fallbackName: targetEmployee.user?.name ?? undefined,
				});

				yield* dbService.query("updateEmployeeAuthUserName", async () => {
					await dbService.db
						.update(user)
						.set({ ...authName, updatedAt: new Date() })
						.where(eq(user.id, targetEmployee.userId));
				});
			}

			const previousStartDate = dateToUtcIsoDate(targetEmployee.startDate);
			const hasStartDateUpdate =
				Object.hasOwn(scopedData, "startDate") && scopedData.startDate !== undefined;
			const nextStartDate = hasStartDateUpdate
				? dateToUtcIsoDate(scopedData.startDate)
				: previousStartDate;
			if (nextStartDate !== previousStartDate) {
				if (previousStartDate && !nextStartDate) {
					yield* Effect.promise(() =>
						requestEmployeeWorkBalanceFullRebuild({ employeeId, organizationId }),
					);
				} else {
					const startDates = [previousStartDate, nextStartDate].filter((value): value is string =>
						Boolean(value),
					);
					const dirtyFromDate = startDates.reduce((earliest, value) =>
						value < earliest ? value : earliest,
					);
					yield* Effect.promise(() =>
						markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }),
					);
				}
			}

			logger.info({ employeeId }, "Employee updated successfully");
			revalidateEmployeesCache(organizationId);
		}),
);

export const updateEmployeeInvitationDraftAction = organizationAction(
	{
		name: "employees.updateInvitationDraft",
		requires: "orgAdmin",
		schema: z.strictObject({
			draftEmployeeId: draftEmployeeIdSchema,
			data: updateEmployeeInvitationDraftSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const { draftEmployeeId, data: validatedData } = input;
			const draftId = decodeEmployeeInvitationDraftId(draftEmployeeId) ?? draftEmployeeId;
			const targetDraft = yield* dbService.query(
				"getEmployeeInvitationDraftForUpdate",
				async () => {
					const rows = await dbService.db
						.select({
							id: employeeInvitationDraft.id,
							normalizedEmail: employeeInvitationDraft.normalizedEmail,
						})
						.from(employeeInvitationDraft)
						.where(
							and(
								eq(employeeInvitationDraft.id, draftId),
								eq(employeeInvitationDraft.organizationId, organizationId),
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
				const targetTeam = yield* dbService.query("getEmployeeInvitationDraftTeam", async () => {
					return await dbService.db.query.team.findFirst({
						where: and(eq(team.id, targetTeamId), eq(team.organizationId, organizationId)),
					});
				});

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
			const hourlyRate = hasHourlyRateUpdate ? parseHourlyRate(validatedData.hourlyRate) : null;
			const { hourlyRate: _hourlyRate, ...draftUpdate } = validatedData;
			// A draft's personnel number follows the employee rule (#1197): not one an
			// employee of the organization or another pending draft holds.
			const draftPersonnelNumber =
				typeof draftUpdate.employeeNumber === "string" ? draftUpdate.employeeNumber : null;
			const draftPersonnelNumberScope = (personnelNumber: string) => ({
				organizationId,
				personnelNumber,
				draftId,
				now: dateFromInstant(systemClock.nowInstant()),
			});
			const notSaved = { saved: false, birthdayUpdate: null } as const;
			const draftSave = yield* dbService
				.query("updateEmployeeInvitationDraft", async () => {
					return await dbService.db.transaction(
						async (tx): Promise<{ saved: boolean; birthdayUpdate: BirthdayChange | null }> => {
							await acquireEmployeeIdentityLock(tx, {
								organizationId,
								normalizedEmail: targetDraft.normalizedEmail,
							});

							const [lockedDraft] = await tx
								.select({
									id: employeeInvitationDraft.id,
									invitationId: employeeInvitationDraft.invitationId,
									employeeNumber: employeeInvitationDraft.employeeNumber,
									birthday: employeeInvitationDraft.birthday,
								})
								.from(employeeInvitationDraft)
								.where(
									and(
										eq(employeeInvitationDraft.id, draftId),
										eq(employeeInvitationDraft.organizationId, organizationId),
									),
								)
								.for("update");

							if (!lockedDraft) return notSaved;

							const [lockedInvitation] = await tx
								.select({ id: invitation.id })
								.from(invitation)
								.where(
									and(
										eq(invitation.id, lockedDraft.invitationId),
										eq(invitation.organizationId, organizationId),
									),
								)
								.for("update");

							if (!lockedInvitation) return notSaved;

							const now = dateFromInstant(systemClock.nowInstant());
							const [eligibleDraft] = await tx
								.select({ id: employeeInvitationDraft.id })
								.from(employeeInvitationDraft)
								.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
								.where(
									and(
										buildEligibleInvitationDraftPredicate({
											organizationId,
											now,
											draftId,
										}),
										eq(employeeInvitationDraft.invitationId, lockedDraft.invitationId),
										eq(invitation.id, lockedDraft.invitationId),
									),
								)
								.limit(1);

							if (!eligibleDraft) return notSaved;

							// Like an employee, a draft saved with its unchanged number keeps it; a
							// clash is dropped and audited when the invitation is accepted.
							if (
								draftPersonnelNumber !== null &&
								personnelNumberKey(draftPersonnelNumber) !==
									personnelNumberKey(lockedDraft.employeeNumber)
							) {
								await refuseTakenDraftPersonnelNumber(
									tx,
									draftPersonnelNumberScope(draftPersonnelNumber),
								);
							}

							const updatedDrafts = await tx
								.update(employeeInvitationDraft)
								.set({
									...draftUpdate,
									...(hasHourlyRateUpdate
										? { currentHourlyRate: hourlyRate?.toString() ?? null }
										: {}),
									updatedBy: actor.userId,
									updatedAt: currentTimestamp(),
								})
								.where(
									and(
										eq(employeeInvitationDraft.id, draftId),
										eq(employeeInvitationDraft.organizationId, organizationId),
									),
								)
								.returning({ id: employeeInvitationDraft.id });
							if (updatedDrafts.length === 0) return notSaved;
							const saved = {
								saved: true,
								// Read under the draft lock, so it is what this save replaced.
								birthdayUpdate: birthdayChange(lockedDraft.birthday, draftUpdate.birthday),
							};
							if (!hasTeamIdUpdate) return saved;

							await tx
								.update(invitation)
								.set({ targetTeamId: validatedData.teamId ?? null })
								.where(
									and(
										eq(invitation.id, lockedInvitation.id),
										eq(invitation.organizationId, organizationId),
										eq(invitation.status, "pending"),
									),
								);

							return saved;
						},
						{ isolationLevel: "serializable" },
					);
				})
				.pipe(
					// Serializable: a concurrent draft save of the same number rolls one back (40001),
					// which is refused like a taken number once the other holds it.
					keepPersonnelNumberRefusal(() =>
						draftPersonnelNumber === null
							? Effect.succeed(null)
							: dbService.query("updateEmployeeInvitationDraft:personnelNumberHolder", () =>
									findDraftPersonnelNumberHolder(
										dbService.db,
										draftPersonnelNumberScope(draftPersonnelNumber),
									),
								),
					),
				);

			if (!draftSave.saved) {
				return yield* Effect.fail(
					new ValidationError({
						message: "This invitation draft can no longer be edited",
						field: "draftEmployeeId",
						value: draftEmployeeId,
					}),
				);
			}

			if (draftSave.birthdayUpdate) {
				yield* recordBirthdayChange({
					organizationId,
					target: { targetType: "employee_invitation_draft", targetId: draftId },
					change: draftSave.birthdayUpdate,
				});
			}

			revalidateEmployeesCache(organizationId);
		}),
);

export const deleteEmployeeInvitationDraftAction = organizationAction(
	{
		name: "employees.deleteInvitationDraft",
		requires: "orgAdmin",
		schema: draftEmployeeIdSchema,
	},
	({ organizationId, input: draftEmployeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const draftId = decodeEmployeeInvitationDraftId(draftEmployeeId) ?? draftEmployeeId;
			const outcome = yield* dbService.query("deleteEmployeeInvitationDraft", async () => {
				return await dbService.db.transaction(async (tx) => {
					const [draftIdentity] = await tx
						.select({ normalizedEmail: employeeInvitationDraft.normalizedEmail })
						.from(employeeInvitationDraft)
						.where(
							and(
								eq(employeeInvitationDraft.id, draftId),
								eq(employeeInvitationDraft.organizationId, organizationId),
							),
						)
						.limit(1);

					if (!draftIdentity) return "notFound" as const;

					await acquireEmployeeIdentityLock(tx, {
						organizationId,
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
						.innerJoin(invitation, eq(employeeInvitationDraft.invitationId, invitation.id))
						.where(
							and(
								eq(employeeInvitationDraft.id, draftId),
								eq(employeeInvitationDraft.organizationId, organizationId),
								eq(invitation.organizationId, organizationId),
							),
						)
						.limit(1)
						.for("update", { of: employeeInvitationDraft });

					if (!lockedDraft || lockedDraft.normalizedEmail !== draftIdentity.normalizedEmail) {
						return "notFound" as const;
					}

					const [existingEmployee] = await tx
						.select({ id: employee.id })
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(
							and(
								eq(employee.organizationId, organizationId),
								sql`lower(btrim(${user.email})) = ${lockedDraft.normalizedEmail}`,
							),
						)
						.limit(1);

					if (existingEmployee) return "employeeExists" as const;
					if (lockedDraft.invitationStatus === "accepted") return "accepted" as const;

					const actionable = isInvitationActionable({
						status: lockedDraft.invitationStatus,
						expiresAt: lockedDraft.invitationExpiresAt,
					});
					if (actionable) {
						const cancellationNow = dateFromInstant(systemClock.nowInstant());
						const canceledInvitations = await tx
							.update(invitation)
							.set({ status: "canceled" })
							.where(
								and(
									eq(invitation.id, lockedDraft.invitationId),
									eq(invitation.organizationId, organizationId),
									eq(invitation.status, "pending"),
									gt(invitation.expiresAt, cancellationNow),
								),
							)
							.returning({ id: invitation.id });

						if (canceledInvitations.length === 0) {
							const [currentDraft] = await tx
								.select({ invitationId: employeeInvitationDraft.invitationId })
								.from(employeeInvitationDraft)
								.where(
									and(
										eq(employeeInvitationDraft.id, draftId),
										eq(employeeInvitationDraft.organizationId, organizationId),
									),
								)
								.limit(1);

							if (currentDraft?.invitationId !== lockedDraft.invitationId) {
								return "cancellationFailed" as const;
							}

							const [currentInvitation] = await tx
								.select({ status: invitation.status, expiresAt: invitation.expiresAt })
								.from(invitation)
								.where(
									and(
										eq(invitation.id, lockedDraft.invitationId),
										eq(invitation.organizationId, organizationId),
									),
								)
								.for("update");

							if (!currentInvitation || currentInvitation.status === "accepted") {
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
							.select({ status: invitation.status, expiresAt: invitation.expiresAt })
							.from(invitation)
							.where(
								and(
									eq(invitation.id, lockedDraft.invitationId),
									eq(invitation.organizationId, organizationId),
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
								eq(employeeInvitationDraft.organizationId, organizationId),
								eq(employeeInvitationDraft.invitationId, lockedDraft.invitationId),
							),
						)
						.returning({ id: employeeInvitationDraft.id });

					return deletedDrafts.length === 1 ? ("deleted" as const) : ("raceLost" as const);
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
						message: "This invitation draft is already associated with an employee",
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

			revalidateEmployeesCache(organizationId);
		}),
);

export const requestEmployeeWorkBalanceRecalculationAction = organizationAction(
	{
		name: "employees.requestWorkBalanceRecalculation",
		requires: "orgAdmin",
		schema: employeeIdSchema,
	},
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const targetEmployee = yield* dbService.query(
				"getEmployeeForWorkBalanceRecalculation",
				async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
						columns: { id: true, organizationId: true },
					});
				},
			);

			if (!targetEmployee) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: employeeId,
					}),
				);
			}

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
					requestedBy: actor.userId,
				},
				"Employee work balance recalculation requested",
			);
		}),
);

function dateToUtcIsoDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	return (
		typeof value === "string"
			? DateTime.fromISO(value, { zone: "utc" })
			: DateTime.fromJSDate(value, { zone: "utc" })
	).toISODate();
}

/** The caller's own personal information on their employee record in the organization. */
export const updateOwnProfileAction = organizationAction(
	{ name: "employees.updateOwnProfile", requires: "member", schema: personalInformationSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const currentEmployee = actor.employee;
			if (!currentEmployee) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
						entityId: actor.userId,
					}),
				);
			}
			const dbService = yield* DatabaseService;
			const { firstName: _firstName, lastName: _lastName, ...employeeProfileData } = input;

			yield* dbService.query("updateOwnProfile", async () => {
				await dbService.db
					.update(employee)
					.set({ ...employeeProfileData, updatedAt: currentTimestamp() })
					.where(
						and(eq(employee.id, currentEmployee.id), eq(employee.organizationId, organizationId)),
					);
			});

			logger.info({ employeeId: currentEmployee.id }, "Profile updated successfully");
		}),
);

/**
 * Replaces the employee's managers. A manager already linked may stay even when
 * no longer on the roster; `ManagerService.assignManager` refuses a former
 * employee for a new link or a primary change (#1438).
 */
export const assignManagersAction = organizationAction(
	{
		name: "employees.assignManagers",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema, data: assignManagersSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { employeeId, data: validatedData } = input;
			yield* loadManagedEmployee({ actor, organizationId }, employeeId, {
				queryName: "assignManagers:target",
			});
			const managerService = yield* ManagerService;
			const existingManagers = yield* managerService.getManagers(employeeId);

			for (const existingManager of existingManagers) {
				if (validatedData.managers.some((manager) => manager.managerId === existingManager.id)) {
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
					actor.userId,
				);
			}

			logger.info(
				{ employeeId, managerCount: validatedData.managers.length },
				"Managers assigned successfully",
			);
		}),
);
