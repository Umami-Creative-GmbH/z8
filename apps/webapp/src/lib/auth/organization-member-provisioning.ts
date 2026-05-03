import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, legalEntity, teamPermissions } from "@/db/schema";

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
	},
) {
	const existingEmployee = await dbClient.query.employee.findFirst({
		where: and(
			eq(employee.userId, input.userId),
			eq(employee.organizationId, input.organizationId),
		),
	});

	if (existingEmployee) {
		return existingEmployee;
	}

	const defaultLegalEntity = await dbClient.query.legalEntity.findFirst({
		where: and(
			eq(legalEntity.organizationId, input.organizationId),
			eq(legalEntity.isDefault, true),
			eq(legalEntity.isActive, true),
		),
		columns: { id: true },
	});

	if (!defaultLegalEntity) {
		throw new Error("No default legal entity exists for this organization.");
	}

	const insertResult = dbClient.insert(employee).values({
		userId: input.userId,
		organizationId: input.organizationId,
		legalEntityId: defaultLegalEntity.id,
		role: hasAdminOrganizationRole(input.memberRole) ? "admin" : "employee",
		isActive: true,
	});

	const [newEmployee] = insertResult.returning ? await insertResult.returning() : [];

	if (newEmployee && hasAdminOrganizationRole(input.memberRole)) {
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
