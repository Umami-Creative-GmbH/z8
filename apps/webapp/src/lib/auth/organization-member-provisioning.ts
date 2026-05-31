import { and, eq, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, teamPermissions } from "@/db/schema";

type OrganizationMemberRole = string | string[] | null | undefined;

type EmployeeProvisioningDb = typeof appDb;

function hasAdminOrganizationRole(memberRole: OrganizationMemberRole) {
	const roles = Array.isArray(memberRole) ? memberRole : [memberRole];
	return roles.includes("owner") || roles.includes("admin");
}

export async function ensureEmployeeForOrganizationMember(
	dbClient: EmployeeProvisioningDb,
	input: {
		userId: string;
		organizationId: string;
		memberRole: OrganizationMemberRole;
		targetTeamId?: string | null;
	},
) {
	const isAdminRole = hasAdminOrganizationRole(input.memberRole);
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
					teamId: input.targetTeamId ?? null,
					...(isAdminRole ? { role: "admin" as const } : {}),
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
		role: isAdminRole ? "admin" : "employee",
		isActive: true,
		teamId: input.targetTeamId ?? null,
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
