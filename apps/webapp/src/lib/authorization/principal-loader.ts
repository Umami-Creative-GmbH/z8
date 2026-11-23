import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee, employeeManagers, teamPermissions } from "@/db/schema";
import {
	customRole,
	customRolePermission,
	employeeCustomRole,
} from "@/db/schema/custom-role";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import type { PermissionFlags } from "@/lib/effect/services/permissions.service";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type {
	Action,
	CustomRoleInfo,
	PrincipalContext,
	Subject,
	TeamPermissions,
} from "./types";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PrincipalLoaderExecutor = Pick<
	typeof db | DatabaseTransaction,
	"select"
>;

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
	// One after another: `executor` may be a transaction, which is one connection,
	// and pg@9 refuses a query while another is executing.
	const [memberRecord] = await executor
		.select()
		.from(member)
		.where(
			and(
				eq(member.userId, userId),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	const [employeeRow] = await executor
		.select({
			employee,
			hasOrganizationAccess: employeeHasOrganizationAccess(),
		})
		.from(employee)
		.where(
			and(
				eq(employee.userId, userId),
				eq(employee.organizationId, organizationId),
			),
		)
		.limit(1);
	// A former employee keeps no organization role, whatever their membership.
	const hasSettingsAccess =
		memberRecord != null && employeeRow?.hasOrganizationAccess !== false;

	return loadOrganizationPrincipalForIdentity(executor, {
		userId,
		organizationId,
		membershipRole: hasSettingsAccess ? memberRecord.role : "",
		employee: hasSettingsAccess ? (employeeRow?.employee ?? null) : null,
	});
}

/** Internal server callers may reuse already authorized identity; public guards
 * continue through loadOrganizationPrincipalContext's fresh database reads.
 */
export async function loadOrganizationPrincipalForIdentity(
	executor: PrincipalLoaderExecutor,
	identity: AuthorizedOrganizationIdentity,
): Promise<PrincipalContext> {
	const { organizationId, employee: authorizedEmployeeRecord } = identity;

	const employeeId = authorizedEmployeeRecord?.id;
	const permRecords = employeeId
		? await executor
				.select()
				.from(teamPermissions)
				.where(
					and(
						eq(teamPermissions.employeeId, employeeId),
						eq(teamPermissions.organizationId, organizationId),
					),
				)
		: [];
	const customRoleRows = employeeId
		? await executor
				.select(customRoleColumns)
				.from(employeeCustomRole)
				.innerJoin(customRole, eq(employeeCustomRole.customRoleId, customRole.id))
				.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
				.where(
					and(
						eq(employeeCustomRole.employeeId, employeeId),
						eq(customRole.organizationId, organizationId),
						eq(customRole.isActive, true),
					),
				)
		: [];
	const managedRecords =
		employeeId && managesEmployees(authorizedEmployeeRecord)
			? await executor
					.select({
						managerId: employeeManagers.managerId,
						employeeId: employeeManagers.employeeId,
					})
					.from(employeeManagers)
					.where(eq(employeeManagers.managerId, employeeId))
			: [];

	return principalFromFacts(identity, {
		permRecords,
		customRoleRows,
		managedRecords,
	});
}

/**
 * The organization-scoped principals of several users at once, read as
 * `loadOrganizationPrincipalContext` reads one: each query covers every user, so
 * a caller judging many recipients (a digest run) does not query per user. A
 * user without a membership or employee row still gets a principal, with no
 * organization role.
 */
export async function loadOrganizationPrincipalContexts(
	executor: PrincipalLoaderExecutor,
	input: { organizationId: string; userIds: readonly string[] },
): Promise<Map<string, PrincipalContext>> {
	const { organizationId } = input;
	const userIds = [...new Set(input.userIds)];
	if (userIds.length === 0) return new Map();
	// One after another, as above: `executor` may be a transaction.
	const memberRecords = await executor
		.select()
		.from(member)
		.where(
			and(
				inArray(member.userId, userIds),
				eq(member.organizationId, organizationId),
				eq(member.status, "approved"),
			),
		);
	const employeeRows = await executor
		.select({
			employee,
			hasOrganizationAccess: employeeHasOrganizationAccess(),
		})
		.from(employee)
		.where(and(inArray(employee.userId, userIds), eq(employee.organizationId, organizationId)));
	const identities = userIds.map((userId): AuthorizedOrganizationIdentity => {
		const memberRecord = memberRecords.find((row) => row.userId === userId);
		const employeeRow = employeeRows.find((row) => row.employee.userId === userId);
		const hasSettingsAccess = memberRecord != null && employeeRow?.hasOrganizationAccess !== false;
		return {
			userId,
			organizationId,
			membershipRole: hasSettingsAccess ? memberRecord.role : "",
			employee: hasSettingsAccess ? (employeeRow?.employee ?? null) : null,
		};
	});
	const employees = identities.flatMap((identity) =>
		identity.employee ? [identity.employee] : [],
	);
	const employeeIds = employees.map((row) => row.id);
	const managerIds = employees.filter(managesEmployees).map((row) => row.id);

	const permRecords =
		employeeIds.length > 0
			? await executor
					.select()
					.from(teamPermissions)
					.where(
						and(
							inArray(teamPermissions.employeeId, employeeIds),
							eq(teamPermissions.organizationId, organizationId),
						),
					)
			: [];
	const customRoleRows =
		employeeIds.length > 0
			? await executor
					.select(customRoleColumns)
					.from(employeeCustomRole)
					.innerJoin(customRole, eq(employeeCustomRole.customRoleId, customRole.id))
					.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
					.where(
						and(
							inArray(employeeCustomRole.employeeId, employeeIds),
							eq(customRole.organizationId, organizationId),
							eq(customRole.isActive, true),
						),
					)
			: [];
	const managedRecords =
		managerIds.length > 0
			? await executor
					.select({
						managerId: employeeManagers.managerId,
						employeeId: employeeManagers.employeeId,
					})
					.from(employeeManagers)
					.where(inArray(employeeManagers.managerId, managerIds))
			: [];

	return new Map(
		identities.map((identity) => {
			const id = identity.employee?.id;
			return [
				identity.userId,
				principalFromFacts(identity, {
					permRecords: permRecords.filter((row) => row.employeeId === id),
					customRoleRows: customRoleRows.filter((row) => row.employeeId === id),
					managedRecords: managedRecords.filter((row) => row.managerId === id),
				}),
			];
		}),
	);
}

/**
 * A platform admin's principal (`user.role` is "admin"), as a signed-in session builds it:
 * every ability, with no organization facts.
 */
export function platformAdminPrincipalContext(
	userId: string,
	activeOrganizationId: string | null,
): PrincipalContext {
	return {
		userId,
		isPlatformAdmin: true,
		activeOrganizationId,
		orgMembership: null,
		employee: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	};
}

/**
 * The principals several users would get from a session in this organization, read together: a
 * platform admin gets `platformAdminPrincipalContext`, as `getPrincipalContext` gives one, and
 * everyone else their `loadOrganizationPrincipalContexts` principal.
 */
export async function loadOrganizationSessionPrincipalContexts(
	executor: PrincipalLoaderExecutor,
	input: { organizationId: string; userIds: readonly string[] },
): Promise<Map<string, PrincipalContext>> {
	const userIds = [...new Set(input.userIds)];
	if (userIds.length === 0) return new Map();
	// One after another, as above: `executor` may be a transaction.
	const platformAdmins = await executor
		.select({ id: user.id })
		.from(user)
		.where(and(inArray(user.id, userIds), eq(user.role, "admin")));
	const principals = await loadOrganizationPrincipalContexts(executor, {
		organizationId: input.organizationId,
		userIds: userIds.filter((userId) => !platformAdmins.some((admin) => admin.id === userId)),
	});
	for (const admin of platformAdmins) {
		principals.set(admin.id, platformAdminPrincipalContext(admin.id, input.organizationId));
	}
	return principals;
}

const customRoleColumns = {
	employeeId: employeeCustomRole.employeeId,
	roleId: customRole.id,
	roleName: customRole.name,
	baseTier: customRole.baseTier,
	action: customRolePermission.action,
	subject: customRolePermission.subject,
};

function managesEmployees(row: { role: string } | null | undefined): boolean {
	return row?.role === "manager" || row?.role === "admin";
}

/** The principal of an authorized identity, from the facts read about its employee. */
function principalFromFacts(
	identity: AuthorizedOrganizationIdentity,
	facts: {
		permRecords: readonly (typeof teamPermissions.$inferSelect)[];
		customRoleRows: readonly {
			roleId: string;
			roleName: string;
			baseTier: CustomRoleInfo["baseTier"];
			action: string;
			subject: string;
		}[];
		managedRecords: readonly { employeeId: string }[];
	},
): PrincipalContext {
	const { userId, organizationId, employee: authorizedEmployeeRecord } = identity;

	const permissions: TeamPermissions = {
		orgWide: null,
		byTeamId: new Map(),
	};

	for (const perm of facts.permRecords) {
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

	const roles = new Map<string, CustomRoleInfo>();
	for (const row of facts.customRoleRows) {
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

	return {
		userId,
		isPlatformAdmin: false,
		activeOrganizationId: organizationId,
		orgMembership: identity.membershipRole
			? {
					organizationId,
					role: identity.membershipRole as "owner" | "admin" | "member",
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
		managedEmployeeIds: facts.managedRecords.map((r) => r.employeeId),
		customRoles: Array.from(roles.values()),
	};
}
