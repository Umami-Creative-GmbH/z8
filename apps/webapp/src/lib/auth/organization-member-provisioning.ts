import { and, eq, exists, isNull, lte, or, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { invitation, member, user } from "@/db/auth-schema";
import {
	employee,
	employeeInvitationDraft,
	team,
	teamPermissions,
} from "@/db/schema";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
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
		employeeNumber: draft.employeeNumber,
		startDate: draft.startDate,
		endDate: draft.endDate,
		contractType: draft.contractType,
		currentHourlyRate: draft.currentHourlyRate,
	};
}

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
		...(draft.employeeNumber != null
			? { employeeNumber: draft.employeeNumber }
			: {}),
		...(draft.startDate != null ? { startDate: draft.startDate } : {}),
		...(draft.endDate != null ? { endDate: draft.endDate } : {}),
		...(draft.contractType != null ? { contractType: draft.contractType } : {}),
		...(draft.currentHourlyRate != null
			? { currentHourlyRate: draft.currentHourlyRate }
			: {}),
	};
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
				exists(sql`
						select 1
						from ${invitation}
						where ${invitation.id} = ${employeeInvitationDraft.invitationId}
						and ${invitation.organizationId} = ${input.organizationId}
						and ${linkedInvitationStatus}
					`),
				exists(sql`
						select 1
						from ${employee}
						inner join ${user} on ${employee.userId} = ${user.id}
						where ${employee.organizationId} = ${input.organizationId}
						and lower(btrim(${user.email})) = ${employeeInvitationDraft.normalizedEmail}
					`),
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
	const transactionResult = await dbClient.transaction(async (tx) => {
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

		if (existingEmployee) {
			if (input.mode === "membershipAccepted" && !existingEmployee.isActive) {
				const [reactivatedEmployee] = await tx
					.update(employee)
					.set({
						isActive: true,
						...reactivationValues,
						...(draft ? {} : isAdminRole ? { role: "admin" as const } : {}),
					})
					.where(
						and(
							eq(employee.id, existingEmployee.id),
							eq(employee.organizationId, input.organizationId),
						),
					)
					.returning();

				const updatedEmployee = reactivatedEmployee ?? existingEmployee;

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
			const insertResult = tx.insert(employee).values({
				userId: input.userId,
				organizationId: input.organizationId,
				role: draft?.role ?? (isAdminRole ? "admin" : "employee"),
				isActive: true,
				...creationValues,
			});

			const [newEmployee] = insertResult.returning
				? await insertResult.returning()
				: [];

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
