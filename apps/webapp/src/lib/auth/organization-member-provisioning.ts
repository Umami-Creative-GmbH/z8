import { and, eq, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, employeeInvitationDraft, team, teamPermissions } from "@/db/schema";

type OrganizationMemberRole = string | string[] | null | undefined;

type EmployeeProvisioningDb = typeof appDb;

function hasAdminOrganizationRole(memberRole: OrganizationMemberRole) {
	const roles = Array.isArray(memberRole) ? memberRole : [memberRole];
	return roles.includes("owner") || roles.includes("admin");
}

async function loadInvitationDraft(
	dbClient: EmployeeProvisioningDb,
	input: { organizationId: string; invitationId?: string | null },
) {
	if (!input.invitationId) return null;
	return await dbClient.query.employeeInvitationDraft.findFirst({
		where: and(
			eq(employeeInvitationDraft.organizationId, input.organizationId),
			eq(employeeInvitationDraft.invitationId, input.invitationId),
		),
	});
}

async function resolveDraftTeamId(
	dbClient: EmployeeProvisioningDb,
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

function draftEmployeeValues(
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

export async function ensureEmployeeForOrganizationMember(
	dbClient: EmployeeProvisioningDb,
	input: {
		userId: string;
		organizationId: string;
		memberRole: OrganizationMemberRole;
		targetTeamId?: string | null;
		invitationId?: string | null;
	},
) {
	const isAdminRole = hasAdminOrganizationRole(input.memberRole);
	const draft = await loadInvitationDraft(dbClient, input);
	const targetTeamId = draft
		? await resolveDraftTeamId(dbClient, input.organizationId, draft.teamId)
		: (input.targetTeamId ?? null);
	const preparedValues = draftEmployeeValues(draft, targetTeamId);
	const existingEmployee = await dbClient.query.employee.findFirst({
		where: and(
			eq(employee.userId, input.userId),
			eq(employee.organizationId, input.organizationId),
		),
	});

	if (existingEmployee) {
		if (!existingEmployee.isActive && existingEmployee.teamId === null) {
			const [reactivatedEmployee] = await dbClient
				.update(employee)
				.set({
					isActive: true,
					...preparedValues,
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
				const existingPermissions = await dbClient.query.teamPermissions.findFirst({
					where: and(
						eq(teamPermissions.employeeId, updatedEmployee.id),
						eq(teamPermissions.organizationId, input.organizationId),
						isNull(teamPermissions.teamId),
					),
				});

				if (!existingPermissions) {
					await dbClient.insert(teamPermissions).values({
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

			return updatedEmployee;
		}

		return existingEmployee;
	}

	const insertResult = dbClient.insert(employee).values({
		userId: input.userId,
		organizationId: input.organizationId,
		role: draft?.role ?? (isAdminRole ? "admin" : "employee"),
		isActive: true,
		...preparedValues,
	});

	const [newEmployee] = insertResult.returning ? await insertResult.returning() : [];

	if (newEmployee && isAdminRole) {
		await dbClient.insert(teamPermissions).values({
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

	return newEmployee;
}

export async function ensureEmployeeProfilesForOrganizationMembers(
	dbClient: EmployeeProvisioningDb,
	organizationId: string,
) {
	const [members, employees] = await Promise.all([
		dbClient.query.member.findMany({
			where: and(eq(member.organizationId, organizationId), eq(member.status, "approved")),
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

	const existingEmployeeUserIds = new Set(employees.map((employeeRecord) => employeeRecord.userId));

	for (const memberRecord of members) {
		if (existingEmployeeUserIds.has(memberRecord.userId)) {
			continue;
		}

		await ensureEmployeeForOrganizationMember(dbClient, {
			userId: memberRecord.userId,
			organizationId: memberRecord.organizationId,
			memberRole: memberRecord.role,
		});
	}
}
