import { and, eq, exists, isNull, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { invitation, member, user } from "@/db/auth-schema";
import {
	employee,
	employeeInvitationDraft,
	team,
	teamPermissions,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { writeFirstEmploymentTerms } from "@/lib/employment-history/first-terms";
import { createLogger } from "@/lib/logger";
import { normalizePersonnelNumber } from "@/lib/organization/personnel-number";
import {
	findPersonnelNumberHolder,
	isPersonnelNumberConflict,
} from "@/lib/organization/personnel-number-uniqueness";
import { hourlyWageSchema } from "@/lib/validations/employment-history";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";
import { acquireEmployeeIdentityLock } from "./employee-identity-lock";
import { normalizeInvitationEmail } from "./employee-invitation-draft";
import { hasOrganizationRole } from "./organization-role";

type OrganizationMemberRole = string | string[] | null | undefined;

export type EmployeeProvisioningMode = "reconcile" | "membershipAccepted";

type EmployeeProvisioningDb = typeof appDb;
type EmployeeProvisioningTransaction = Parameters<
	Parameters<EmployeeProvisioningDb["transaction"]>[0]
>[0];
type EmployeeProvisioningClient =
	| EmployeeProvisioningDb
	| EmployeeProvisioningTransaction;

const logger = createLogger("organization-member-provisioning");

async function loadInvitationDraft(
	dbClient: EmployeeProvisioningClient,
	input: {
		organizationId: string;
		invitationId?: string | null;
		normalizedEmail: string;
		allowIdentityFallback: boolean;
	},
) {
	const exactDraft = input.invitationId
		? await dbClient.query.employeeInvitationDraft.findFirst({
				where: and(
					eq(employeeInvitationDraft.organizationId, input.organizationId),
					eq(employeeInvitationDraft.invitationId, input.invitationId),
				),
			})
		: null;
	if (exactDraft) return { draft: exactDraft, identityFallback: false };
	if (!input.allowIdentityFallback) return null;

	const identityDraft = await dbClient.query.employeeInvitationDraft.findFirst({
		where: and(
			eq(employeeInvitationDraft.organizationId, input.organizationId),
			eq(employeeInvitationDraft.normalizedEmail, input.normalizedEmail),
		),
	});
	return identityDraft
		? { draft: identityDraft, identityFallback: true }
		: null;
}

async function resolveDraftTeamId(
	dbClient: EmployeeProvisioningClient,
	organizationId: string,
	teamId?: string | null,
) {
	if (!teamId) return null;
	const targetTeam = await dbClient.query.team.findFirst({
		where: and(eq(team.id, teamId), eq(team.organizationId, organizationId)),
		columns: { id: true },
	});
	return targetTeam?.id ?? null;
}

/**
 * The employee values a draft gives a new employee. The personnel number is
 * left out: `writeWithDraftPersonnelNumber` adds it only while it is free.
 */
function draftEmployeeCreationValues(
	draft: typeof employeeInvitationDraft.$inferSelect | null,
	teamId: string | null,
) {
	if (!draft) return { teamId };
	return {
		teamId,
		role: draft.role,
		firstName: draft.firstName,
		lastName: draft.lastName,
		gender: draft.gender,
		pronouns: draft.pronouns,
		birthday: draft.birthday,
		position: draft.position,
		startDate: draft.startDate,
		endDate: draft.endDate,
		contractType: draft.contractType,
	};
}

/** Like `draftEmployeeCreationValues`, for a reactivated employee: only what the draft sets. */
function draftEmployeeReactivationValues(
	draft: typeof employeeInvitationDraft.$inferSelect | null,
	teamId: string | null,
) {
	if (!draft) return {};
	return {
		...(teamId != null ? { teamId } : {}),
		...(draft.role != null ? { role: draft.role } : {}),
		...(draft.firstName != null ? { firstName: draft.firstName } : {}),
		...(draft.lastName != null ? { lastName: draft.lastName } : {}),
		...(draft.gender != null ? { gender: draft.gender } : {}),
		...(draft.pronouns != null ? { pronouns: draft.pronouns } : {}),
		...(draft.birthday != null ? { birthday: draft.birthday } : {}),
		...(draft.position != null ? { position: draft.position } : {}),
		...(draft.startDate != null ? { startDate: draft.startDate } : {}),
		...(draft.endDate != null ? { endDate: draft.endDate } : {}),
		...(draft.contractType != null ? { contractType: draft.contractType } : {}),
	};
}

/** A draft personnel number acceptance did not copy because another employee held it. */
type DroppedPersonnelNumber = {
	droppedPersonnelNumber: string;
	/** Null when the employee who won a concurrent save can no longer be found. */
	heldByEmployeeId: string | null;
};

/**
 * Writes the new or reactivated employee with the draft's personnel number
 * (#1197) when it is free, and without it when another employee of the
 * organization holds it, so acceptance never fails because of the number. A
 * concurrent save that takes the number first hits the unique index inside a
 * savepoint, and the write is repeated without the number.
 */
async function writeWithDraftPersonnelNumber<T>(
	tx: EmployeeProvisioningTransaction,
	input: {
		organizationId: string;
		/** The draft's number, normalized; null writes none. */
		personnelNumber: string | null;
		/** The reactivated employee, whose own number is no clash. */
		exceptEmployeeId?: string;
	},
	write: (
		client: EmployeeProvisioningTransaction,
		personnelNumber: { employeeNumber: string } | Record<string, never>,
	) => Promise<T>,
): Promise<{ written: T; dropped: DroppedPersonnelNumber | null }> {
	const { personnelNumber } = input;
	if (personnelNumber === null) return { written: await write(tx, {}), dropped: null };
	const scope = {
		organizationId: input.organizationId,
		personnelNumber,
		exceptEmployeeId: input.exceptEmployeeId,
	};
	const dropWith = async (heldByEmployeeId: string | null) => ({
		written: await write(tx, {}),
		dropped: { droppedPersonnelNumber: personnelNumber, heldByEmployeeId },
	});

	const holder = await findPersonnelNumberHolder(tx, scope);
	if (holder) return dropWith(holder.employeeId);
	try {
		const written = await tx.transaction((savepoint) =>
			write(savepoint, { employeeNumber: personnelNumber }),
		);
		return { written, dropped: null };
	} catch (error) {
		if (!isPersonnelNumberConflict(error)) throw error;
		const winner = await findPersonnelNumberHolder(tx, scope);
		return dropWith(winner?.employeeId ?? null);
	}
}

/** The audit entry of a draft personnel number acceptance dropped (#1197). */
function recordDroppedPersonnelNumber(
	tx: EmployeeProvisioningTransaction,
	audit: AuditTrail,
	input: {
		organizationId: string;
		userId: string;
		employee: { id: string; employeeNumber: string | null };
		draft: typeof employeeInvitationDraft.$inferSelect;
		dropped: DroppedPersonnelNumber;
		outcome: "created" | "reactivated";
	},
) {
	return audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.EMPLOYEE_PERSONNEL_NUMBER_DROPPED,
		// The invitee's acceptance dropped the number.
		actorUserId: input.userId,
		targetType: "employee",
		targetId: input.employee.id,
		employeeId: input.employee.id,
		metadata: {
			...input.dropped,
			reason: "personnel_number_taken",
			outcome: input.outcome,
			invitationId: input.draft.invitationId,
			draftId: input.draft.id,
			...(input.outcome === "reactivated"
				? { keptPersonnelNumber: input.employee.employeeNumber }
				: {}),
		},
	});
}

/**
 * The draft's contract becomes the employee's first employment terms, in the
 * provisioning transaction: when the terms cannot be written, no employee is
 * created or reactivated. Only hourly drafts with a wage get terms.
 */
function writeDraftFirstTerms(
	tx: EmployeeProvisioningTransaction,
	input: {
		organizationId: string;
		userId: string;
		employeeId: string;
		draft: typeof employeeInvitationDraft.$inferSelect;
	},
) {
	const { draft } = input;
	return writeFirstEmploymentTerms(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		// The org admin who prepared the draft set the wage.
		actorUserId: draft.updatedBy ?? input.userId,
		contractType: draft.contractType,
		hourlyRate: draftHourlyWage(draft.currentHourlyRate),
		startDate: draft.startDate ?? null,
	});
}

/** The draft's stored decimal-string wage, as employment terms hold it. */
function draftHourlyWage(stored: string | null): number | null {
	if (stored == null) return null;
	const parsed = hourlyWageSchema.safeParse(stored);
	if (!parsed.success) {
		throw new ValidationError({
			message: parsed.error.issues[0]?.message ?? "Invalid hourly rate",
			field: "hourlyRate",
		});
	}
	return parsed.data;
}

async function consumeEmployeeInvitationDraft(
	dbClient: EmployeeProvisioningClient,
	input: {
		organizationId: string;
		draftId?: string;
		allowStaleLinkedInvitation?: boolean;
	},
) {
	try {
		const staleBoundary = dateFromInstant(systemClock.nowInstant());
		const linkedInvitationStatus = input.allowStaleLinkedInvitation
			? or(
					eq(invitation.status, "accepted"),
					eq(invitation.status, "canceled"),
					and(
						eq(invitation.status, "pending"),
						lte(invitation.expiresAt, staleBoundary),
					),
				)
			: eq(invitation.status, "accepted");
		await dbClient.delete(employeeInvitationDraft).where(
			and(
				eq(employeeInvitationDraft.organizationId, input.organizationId),
				input.draftId
					? eq(employeeInvitationDraft.id, input.draftId)
					: undefined,
				// Drizzle renders a raw `sql` argument to exists() without parentheses,
				// so each subquery carries its own; `exists select` is a syntax error (#1185).
				exists(sql`(
						select 1
						from ${invitation}
						where ${invitation.id} = ${employeeInvitationDraft.invitationId}
						and ${invitation.organizationId} = ${input.organizationId}
						and ${linkedInvitationStatus}
					)`),
				exists(sql`(
						select 1
						from ${employee}
						inner join ${user} on ${employee.userId} = ${user.id}
						where ${employee.organizationId} = ${input.organizationId}
						and lower(btrim(${user.email})) = ${employeeInvitationDraft.normalizedEmail}
					)`),
			),
		);
	} catch {
		logger.warn(
			{
				operation: "consumeEmployeeInvitationDraft",
				organizationId: input.organizationId,
				draftId: input.draftId ?? null,
			},
			"Employee invitation draft cleanup failed",
		);
	}
}

export async function ensureEmployeeForOrganizationMember(
	dbClient: EmployeeProvisioningDb,
	input: {
		mode: EmployeeProvisioningMode;
		userId: string;
		organizationId: string;
		memberRole: OrganizationMemberRole;
		targetTeamId?: string | null;
		invitationId?: string | null;
	},
) {
	// Entries reach the external audit service only once the transaction committed.
	const audit = new AuditTrail();
	const transactionResult = await dbClient.transaction(async (tx) => {
		// Provisioning creates, reactivates, places or grants the user's employee:
		// facts manual creation reads under the user's shared guard (#318). The
		// exclusive guard precedes the identity lock and every row it writes.
		await acquireExclusiveUserConfigurationAccessGuards(tx, [input.userId]);
		const targetUser = await tx.query.user.findFirst({
			where: eq(user.id, input.userId),
			columns: { email: true },
		});
		if (!targetUser) {
			throw new Error("Cannot provision an employee for a missing user");
		}

		const normalizedEmail = normalizeInvitationEmail(targetUser.email);
		await acquireEmployeeIdentityLock(tx, {
			organizationId: input.organizationId,
			normalizedEmail,
		});

		const isAdminRole =
			hasOrganizationRole(input.memberRole, "owner") ||
			hasOrganizationRole(input.memberRole, "admin");
		const loadedDraft = await loadInvitationDraft(tx, {
			organizationId: input.organizationId,
			invitationId: input.invitationId,
			normalizedEmail,
			allowIdentityFallback: input.mode === "membershipAccepted",
		});
		const draft = loadedDraft?.draft ?? null;
		const draftTeamCandidate = draft
			? draft.teamId
			: (input.targetTeamId ?? null);
		const targetTeamId = draft
			? await resolveDraftTeamId(tx, input.organizationId, draftTeamCandidate)
			: (input.targetTeamId ?? null);
		const creationValues = draftEmployeeCreationValues(draft, targetTeamId);
		const reactivationValues = draftEmployeeReactivationValues(
			draft,
			targetTeamId,
		);
		const existingEmployee = await tx.query.employee.findFirst({
			where: and(
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
			),
		});
		let provisionedEmployee: typeof existingEmployee;
		// Old drafts may hold a blank number: that is no number (#881).
		const draftPersonnelNumber = normalizePersonnelNumber(draft?.employeeNumber);

		if (existingEmployee) {
			if (input.mode === "membershipAccepted" && !existingEmployee.isActive) {
				const {
					written: [reactivatedEmployee],
					dropped,
				} = await writeWithDraftPersonnelNumber(
					tx,
					{
						organizationId: input.organizationId,
						personnelNumber: draftPersonnelNumber,
						exceptEmployeeId: existingEmployee.id,
					},
					(client, personnelNumber) =>
						client
							.update(employee)
							.set({
								isActive: true,
								...reactivationValues,
								...personnelNumber,
								...(draft ? {} : isAdminRole ? { role: "admin" as const } : {}),
							})
							.where(
								and(
									eq(employee.id, existingEmployee.id),
									eq(employee.organizationId, input.organizationId),
								),
							)
							.returning(),
				);

				const updatedEmployee = reactivatedEmployee ?? existingEmployee;

				if (draft && dropped) {
					await recordDroppedPersonnelNumber(tx, audit, {
						organizationId: input.organizationId,
						userId: input.userId,
						employee: updatedEmployee,
						draft,
						dropped,
						outcome: "reactivated",
					});
				}

				// The database keeps an employee whose employment ended inactive
				// (only a rehire starts a new one), so only a reactivated employee
				// gets the draft's terms.
				if (draft && reactivatedEmployee?.isActive) {
					await writeDraftFirstTerms(tx, {
						organizationId: input.organizationId,
						userId: input.userId,
						employeeId: reactivatedEmployee.id,
						draft,
					});
				}

				if (isAdminRole) {
					const existingPermissions = await tx.query.teamPermissions.findFirst({
						where: and(
							eq(teamPermissions.employeeId, updatedEmployee.id),
							eq(teamPermissions.organizationId, input.organizationId),
							isNull(teamPermissions.teamId),
						),
					});

					if (!existingPermissions) {
						await tx.insert(teamPermissions).values({
							employeeId: updatedEmployee.id,
							organizationId: input.organizationId,
							teamId: null,
							canCreateTeams: true,
							canManageTeamMembers: true,
							canManageTeamSettings: true,
							canApproveTeamRequests: true,
							grantedBy: updatedEmployee.id,
						});
					}
				}

				provisionedEmployee = updatedEmployee;
			} else {
				provisionedEmployee = existingEmployee;
			}
		} else {
			const {
				written: [newEmployee],
				dropped,
			} = await writeWithDraftPersonnelNumber(
				tx,
				{
					organizationId: input.organizationId,
					personnelNumber: draftPersonnelNumber,
				},
				async (client, personnelNumber) => {
					const insertResult = client.insert(employee).values({
						userId: input.userId,
						organizationId: input.organizationId,
						role: draft?.role ?? (isAdminRole ? "admin" : "employee"),
						isActive: true,
						...creationValues,
						...personnelNumber,
					});
					return insertResult.returning ? await insertResult.returning() : [];
				},
			);

			if (newEmployee && draft && dropped) {
				await recordDroppedPersonnelNumber(tx, audit, {
					organizationId: input.organizationId,
					userId: input.userId,
					employee: newEmployee,
					draft,
					dropped,
					outcome: "created",
				});
			}

			if (newEmployee && draft) {
				await writeDraftFirstTerms(tx, {
					organizationId: input.organizationId,
					userId: input.userId,
					employeeId: newEmployee.id,
					draft,
				});
			}

			if (newEmployee && isAdminRole) {
				await tx.insert(teamPermissions).values({
					employeeId: newEmployee.id,
					organizationId: input.organizationId,
					teamId: null,
					canCreateTeams: true,
					canManageTeamMembers: true,
					canManageTeamSettings: true,
					canApproveTeamRequests: true,
					grantedBy: newEmployee.id,
				});
			}

			provisionedEmployee = newEmployee;
		}

		return {
			provisionedEmployee,
			acceptedDraftCleanup:
				input.mode === "membershipAccepted" && draft
					? {
							organizationId: input.organizationId,
							draftId: draft.id,
							allowStaleLinkedInvitation: loadedDraft?.identityFallback,
						}
					: null,
		};
	});
	audit.forwardCommitted();

	if (transactionResult.acceptedDraftCleanup) {
		await consumeEmployeeInvitationDraft(
			dbClient,
			transactionResult.acceptedDraftCleanup,
		);
	}

	return transactionResult.provisionedEmployee;
}

export async function ensureEmployeeProfilesForOrganizationMembers(
	dbClient: EmployeeProvisioningDb,
	organizationId: string,
) {
	const [members, employees] = await Promise.all([
		dbClient.query.member.findMany({
			where: and(
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
			columns: {
				userId: true,
				organizationId: true,
				role: true,
			},
		}),
		dbClient.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: {
				userId: true,
			},
		}),
	]);

	const existingEmployeeUserIds = new Set(
		employees.map((employeeRecord) => employeeRecord.userId),
	);

	const provisioningTasks = [];
	for (const memberRecord of members) {
		if (existingEmployeeUserIds.has(memberRecord.userId)) {
			continue;
		}

		provisioningTasks.push(
			ensureEmployeeForOrganizationMember(dbClient, {
				mode: "reconcile",
				userId: memberRecord.userId,
				organizationId: memberRecord.organizationId,
				memberRole: memberRecord.role,
			}),
		);
	}

	await Promise.all(provisioningTasks);
	await consumeEmployeeInvitationDraft(dbClient, { organizationId });
}
