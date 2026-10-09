import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { employee, employeeDocument, teamMembership } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	type EmployeeRef,
	type EmployeeScope,
	ORGANIZATION_ADMIN_GRANT,
	type PersonnelFileAccess,
} from "./access";

/**
 * The database side of the personnel file access resolver (ADR 0001). It is
 * the single choke point for the feature toggle: with personnel files turned
 * off the resolver grants nothing, so every page, action, route and job that
 * resolves access first is unavailable while documents stay stored.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

export async function isPersonnelFilesEnabled(
	database: Reader,
	organizationId: string,
): Promise<boolean> {
	const [row] = await database
		.select({ enabled: organization.personnelFilesEnabled })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	return row?.enabled === true;
}

/**
 * Resolves what the user may do with personnel files in the organization.
 * Null when personnel files are off, the user is no approved member, or their
 * employment there ended (a former employee loses every access at the
 * departure cutoff, admins included).
 */
export async function resolvePersonnelFileAccess(
	database: Reader,
	input: { userId: string; organizationId: string; now?: Instant },
): Promise<PersonnelFileAccess | null> {
	if (!(await isPersonnelFilesEnabled(database, input.organizationId))) return null;
	const [[membership], [profile]] = await Promise.all([
		database
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		database
			.select({ id: employee.id, hasAccess: employeeHasOrganizationAccess(input.now) })
			.from(employee)
			.where(
				and(eq(employee.userId, input.userId), eq(employee.organizationId, input.organizationId)),
			)
			.limit(1),
	]);
	if (!membership) return null;
	if (profile && !profile.hasAccess) return null;
	const isOrganizationAdmin =
		hasOrganizationRole(membership.role, "owner") || hasOrganizationRole(membership.role, "admin");
	return {
		organizationId: input.organizationId,
		userId: input.userId,
		selfEmployeeId: profile?.id ?? null,
		// Slice 2 (#866) adds the user's active personnel file officer grant here.
		grants: isOrganizationAdmin ? [ORGANIZATION_ADMIN_GRANT] : [],
	};
}

/**
 * An employee of the organization with their current teams (primary team and
 * team memberships), departed employees included: their files stay managed.
 */
export async function loadEmployeeRef(
	database: Reader,
	input: { organizationId: string; employeeId: string },
): Promise<EmployeeRef | null> {
	const [row] = await database
		.select({ id: employee.id, teamId: employee.teamId })
		.from(employee)
		.where(
			and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		)
		.limit(1);
	if (!row) return null;
	const memberships = await database
		.select({ teamId: teamMembership.teamId })
		.from(teamMembership)
		.where(
			and(
				eq(teamMembership.employeeId, row.id),
				eq(teamMembership.organizationId, input.organizationId),
			),
		);
	const teamIds = new Set(memberships.map((membership) => membership.teamId));
	if (row.teamId) teamIds.add(row.teamId);
	return { id: row.id, teamIds: [...teamIds] };
}

function employeeInScope(organizationId: string, scope: EmployeeScope): SQL {
	if (scope.kind === "all") return sql`true`;
	const conditions: SQL[] = [];
	if (scope.employeeIds.length > 0) {
		conditions.push(inArray(employeeDocument.employeeId, [...scope.employeeIds]));
	}
	if (scope.teamIds.length > 0) {
		const teamIds = [...scope.teamIds];
		conditions.push(
			sql`${employeeDocument.employeeId} IN (SELECT ${employee.id} FROM ${employee}
				WHERE ${employee.organizationId} = ${organizationId}
				AND ${inArray(employee.teamId, teamIds)})`,
			sql`${employeeDocument.employeeId} IN (SELECT ${teamMembership.employeeId} FROM ${teamMembership}
				WHERE ${teamMembership.organizationId} = ${organizationId}
				AND ${inArray(teamMembership.teamId, teamIds)})`,
		);
	}
	return conditions.length > 0 ? (or(...conditions) as SQL) : sql`false`;
}

/**
 * The employee documents the actor may see, as a condition on
 * `employee_document`: documents of the categories each grant covers for the
 * employees in its scope, plus the actor's own shared documents. Always
 * scoped to the actor's organization.
 */
export function visibleDocumentsCondition(access: PersonnelFileAccess): SQL {
	const visible: SQL[] = access.grants
		.filter((grant) => grant.categories.size > 0)
		.map(
			(grant) =>
				and(
					employeeInScope(access.organizationId, grant.scope),
					inArray(employeeDocument.category, [...grant.categories]),
				) as SQL,
		);
	if (access.selfEmployeeId) {
		visible.push(
			and(
				eq(employeeDocument.employeeId, access.selfEmployeeId),
				eq(employeeDocument.visibility, "shared"),
			) as SQL,
		);
	}
	return and(
		eq(employeeDocument.organizationId, access.organizationId),
		visible.length > 0 ? (or(...visible) as SQL) : sql`false`,
	) as SQL;
}
