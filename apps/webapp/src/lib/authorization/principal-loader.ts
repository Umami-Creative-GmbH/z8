import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, employeeManagers, teamPermissions } from "@/db/schema";
import { customRole, customRolePermission, employeeCustomRole } from "@/db/schema/custom-role";
import type { PermissionFlags } from "@/lib/effect/services/permissions.service";
import type { Action, CustomRoleInfo, PrincipalContext, Subject, TeamPermissions } from "./types";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PrincipalLoaderExecutor = Pick<typeof db | DatabaseTransaction, "select">;

/**
 * Loads the organization-scoped principal for one non-platform-admin user from
 * the database. Session handling, SSO admission and platform-admin detection
 * stay with the caller; this only reads membership, employee, permission,
 * custom-role and manager facts, optionally inside the caller's transaction.
 */
export async function loadOrganizationPrincipalContext(
	executor: PrincipalLoaderExecutor,
	input: { userId: string; organizationId: string },
): Promise<PrincipalContext> {
	const { userId, organizationId } = input;
	const [[memberRecord], [employeeRecord]] = await Promise.all([
		executor
			.select()
			.from(member)
			.where(
				and(
					eq(member.userId, userId),
					eq(member.organizationId, organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		executor
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, userId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			)
			.limit(1),
	]);

	const authorizedEmployeeRecord = memberRecord ? employeeRecord : null;

	const permissions: TeamPermissions = {
		orgWide: null,
		byTeamId: new Map(),
	};

	if (authorizedEmployeeRecord) {
		const permRecords = await executor
			.select()
			.from(teamPermissions)
			.where(eq(teamPermissions.employeeId, authorizedEmployeeRecord.id));

		for (const perm of permRecords) {
			const flags: PermissionFlags = {
				canCreateTeams: perm.canCreateTeams,
				canManageTeamMembers: perm.canManageTeamMembers,
				canManageTeamSettings: perm.canManageTeamSettings,
				canApproveTeamRequests: perm.canApproveTeamRequests,
			};

			if (perm.teamId === null) {
				permissions.orgWide = flags;
			} else {
				permissions.byTeamId.set(perm.teamId, flags);
			}
		}
	}

	let customRoles: CustomRoleInfo[] = [];
	if (authorizedEmployeeRecord) {
		const customRoleRows = await executor
			.select({
				roleId: customRole.id,
				roleName: customRole.name,
				baseTier: customRole.baseTier,
				action: customRolePermission.action,
				subject: customRolePermission.subject,
			})
			.from(employeeCustomRole)
			.innerJoin(customRole, eq(employeeCustomRole.customRoleId, customRole.id))
			.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
			.where(
				and(
					eq(employeeCustomRole.employeeId, authorizedEmployeeRecord.id),
					eq(customRole.organizationId, organizationId),
					eq(customRole.isActive, true),
				),
			);

		const roles = new Map<string, CustomRoleInfo>();
		for (const row of customRoleRows) {
			const role = roles.get(row.roleId) ?? {
				roleId: row.roleId,
				roleName: row.roleName,
				baseTier: row.baseTier,
				permissions: [],
			};

			role.permissions.push({
				action: row.action as Action,
				subject: row.subject as Subject,
			});
			roles.set(row.roleId, role);
		}
		customRoles = Array.from(roles.values());
	}

	let managedEmployeeIds: string[] = [];

	if (
		authorizedEmployeeRecord &&
		(authorizedEmployeeRecord.role === "manager" || authorizedEmployeeRecord.role === "admin")
	) {
		const managedRecords = await executor
			.select({ employeeId: employeeManagers.employeeId })
			.from(employeeManagers)
			.where(eq(employeeManagers.managerId, authorizedEmployeeRecord.id));

		managedEmployeeIds = managedRecords.map((r) => r.employeeId);
	}

	return {
		userId,
		isPlatformAdmin: false,
		activeOrganizationId: organizationId,
		orgMembership: memberRecord
			? {
					organizationId: memberRecord.organizationId,
					role: memberRecord.role as "owner" | "admin" | "member",
					status: "active",
				}
			: null,
		employee: authorizedEmployeeRecord
			? {
					id: authorizedEmployeeRecord.id,
					organizationId: authorizedEmployeeRecord.organizationId,
					role: authorizedEmployeeRecord.role,
					teamId: authorizedEmployeeRecord.teamId,
				}
			: null,
		permissions,
		managedEmployeeIds,
		customRoles,
	};
}
