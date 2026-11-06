import "server-only";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { db as database } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import {
	equipmentAssignment,
	equipmentItem,
	equipmentOfficerGrant,
} from "@/db/schema/equipment";
import type { AuthorizedOrganizationIdentity } from "@/lib/auth/organization-identity";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	employeeHasOrganizationAccess,
	resolveEmployeeOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import {
	assertReadCommitted,
	lockLifecycleOrganization,
} from "@/lib/employee-lifecycle/locks";
import type { MfaSession } from "@/lib/organization-mfa/access";
import { withMfaDatabase } from "@/lib/organization-mfa/database-context";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";
import {
	employeeCoordinationGuard,
	holdGuard,
	userConfigurationAccessGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import { type EquipmentTransaction, lockEquipmentOrganization } from "./setup";
export type EquipmentActor = {
	organizationId: string;
	userId: string;
	session: MfaSession;
};
/**
 * Lifecycle/access user guards (sorted), employee coordination, organization row,
 * then equipment. Never acquire a lifecycle guard while holding equipment. The
 * shared user guards also protect an actor recording equipment for someone else.
 */
export async function lockEquipmentContext(
	tx: EquipmentTransaction,
	actor: Pick<EquipmentActor, "organizationId" | "userId">,
	target?: { id: string; userId: string },
	additionalUserIds: string[] = [],
) {
	await assertReadCommitted(tx);
	for (const userId of [
		...new Set([
			actor.userId,
			...additionalUserIds,
			...(target ? [target.userId] : []),
		]),
	].sort())
		await holdGuard(tx, userConfigurationAccessGuard(userId));
	if (target) await holdGuard(tx, employeeCoordinationGuard(target.id));
	await lockLifecycleOrganization(tx, actor.organizationId);
	await lockEquipmentOrganization(tx, actor.organizationId);
}

/** Shared permission decision for reads and every command; managers gain no staff scope. */
export async function equipmentAccess(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
) {
	const denied = () =>
		new AuthorizationError({
			message: "Equipment access is not available.",
			resource: "equipment",
			action: "read",
		});
	const authenticated = await withMfaDatabase(tx, () =>
		canAccessOrganization(actor.session, actor.organizationId),
	);
	if (!authenticated) throw denied();
	const access = await equipmentWorkerAccess(
		tx,
		actor,
		systemClock.nowInstant(),
	);
	if (!access) throw denied();
	return access;
}

/** Scheduled delivery has no browser session; membership, employment and grant stay live. */
export async function equipmentWorkerAccess(
	tx: EquipmentTransaction,
	actor: Pick<EquipmentActor, "organizationId" | "userId">,
	now: Instant,
) {
	const access = await resolveEmployeeOrganizationAccess(tx, {
		...actor,
		now,
	});
	if (!access.allowed) return null;
	const [membership] = await tx
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.organizationId, actor.organizationId),
				eq(member.userId, actor.userId),
				eq(member.status, "approved"),
			),
		);
	const canAdminister =
		hasOrganizationRole(membership?.role, "owner") ||
		hasOrganizationRole(membership?.role, "admin");
	const [grant] = access.employeeId
		? await tx
				.select()
				.from(equipmentOfficerGrant)
				.where(
					and(
						eq(equipmentOfficerGrant.organizationId, actor.organizationId),
						eq(equipmentOfficerGrant.employeeId, access.employeeId),
						sql`${equipmentOfficerGrant.revokedAt} is null`,
					),
				)
		: [];
	return {
		employeeId: access.employeeId,
		isOfficer: !!grant,
		canAdminister,
		canManage: canAdminister || !!grant,
		all: canAdminister || grant?.scope === "all",
		teamIds: grant?.teamIds ?? [],
		employeeIds: grant?.employeeIds ?? [],
	};
}

/** Current roster coverage and discoverability never authorize all of a person's history. */
export function equipmentSubjectScope(
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	now: Instant = systemClock.nowInstant(),
	includeFormer = true,
): SQL<boolean> {
	if (access.all) return sql`true`;
	const direct = access.employeeIds.length
		? sql`${employee.id} = any(ARRAY[${sql.join(
				access.employeeIds.map((id) => sql`${id}::uuid`),
				sql`,`,
			)}]::uuid[])`
		: sql`false`;
	if (!access.teamIds.length) return sql<boolean>`${direct}`;
	const teams = sql.join(
		access.teamIds.map((id) => sql`${id}::uuid`),
		sql`,`,
	);
	return sql`(${direct} or (${employeeHasOrganizationAccess(now)} and exists(select 1 from team_membership tm where tm.organization_id=${employee.organizationId} and tm.employee_id=${employee.id} and tm.team_id in (${teams}))) or ${includeFormer ? sql`exists(select 1 from equipment_former_team_scope fs where fs.organization_id=${employee.organizationId} and fs.employee_id=${employee.id} and fs.team_ids && ARRAY[${teams}]::uuid[])` : sql`false`})`;
}

/** An ending snapshot belongs to one assignment context, including a reopened period's deactivation. */
export function equipmentContextScope(
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	context: {
		organizationId: SQL;
		employeeId: SQL;
		periodId: SQL;
		deactivationId: SQL;
		departureId: SQL;
	},
	now: Instant = systemClock.nowInstant(),
): SQL<boolean> {
	if (access.all) return sql`true`;
	const { organizationId, employeeId, periodId, deactivationId, departureId } =
		context;
	const direct = access.employeeIds.length
		? sql`${employee.id} = any(ARRAY[${sql.join(
				access.employeeIds.map((id) => sql`${id}::uuid`),
				sql`,`,
			)}]::uuid[])`
		: sql`false`;
	const teams = sql.join(
		access.teamIds.map((id) => sql`${id}::uuid`),
		sql`,`,
	);
	const teamScope = !access.teamIds.length
		? sql`false`
		: sql`(
 exists(select 1 from equipment_former_team_scope fs where fs.organization_id=${employee.organizationId} and fs.employee_id=${employee.id} and fs.ending_id is not distinct from coalesce(${deactivationId},${departureId},${periodId}) and fs.team_ids && ARRAY[${teams}]::uuid[])
 or (${deactivationId} is null and not exists(select 1 from equipment_former_team_scope fs where fs.organization_id=${employee.organizationId} and fs.employee_id=${employee.id} and fs.ending_id is not distinct from coalesce(${departureId},${periodId}))
 and not exists(select 1 from employee_employment_period p where p.organization_id=${employee.organizationId} and p.employee_id=${employee.id} and p.id=${periodId} and p.status='closed')
 and ${employeeHasOrganizationAccess(now)} and exists(select 1 from team_membership tm where tm.organization_id=${employee.organizationId} and tm.employee_id=${employee.id} and tm.team_id in (${teams}))))`;
	return sql`exists(select 1 from employee where ${employee.id}=${employeeId} and ${employee.organizationId}=${organizationId} and (${direct} or ${teamScope}))`;
}
export function equipmentAssignmentScope(
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	alias: SQL = sql`equipment_assignment`,
	now: Instant = systemClock.nowInstant(),
) {
	return equipmentContextScope(
		access,
		{
			organizationId: sql`${alias}.organization_id`,
			employeeId: sql`${alias}.employee_id`,
			periodId: sql`${alias}.employment_period_id`,
			deactivationId: sql`${alias}.deactivation_id`,
			departureId: sql`${alias}.departure_id`,
		},
		now,
	);
}
export async function equipmentCoversAssignment(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	assignmentId: string,
) {
	const [covered] = await tx
		.select({ id: equipmentAssignment.id })
		.from(equipmentAssignment)
		.where(
			and(
				eq(equipmentAssignment.organizationId, actor.organizationId),
				eq(equipmentAssignment.id, assignmentId),
				equipmentAssignmentScope(access),
			),
		);
	return !!covered;
}
export async function equipmentCoversEmployee(
	tx: EquipmentTransaction,
	actor: EquipmentActor,
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	employeeId: string,
) {
	const [subject] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, actor.organizationId),
				eq(employee.id, employeeId),
				equipmentSubjectScope(access),
			),
		);
	return !!subject;
}

/** Shared items can be managed after a covered handover, but another current holder fences old scope. */
export function equipmentItemScope(
	access: Awaited<ReturnType<typeof equipmentAccess>>,
): SQL<boolean> {
	if (access.all) return sql`true`;
	return sql`exists (select 1 from equipment_assignment ea inner join employee on employee.id = ea.employee_id and employee.organization_id = ea.organization_id
 where ea.organization_id = ${equipmentItem.organizationId} and ea.item_id = ${equipmentItem.id}
 and (not ${equipmentItem.inCustody} or not ea.received) and (${equipmentAssignmentScope(access, sql`ea`)}))`;
}

/** Navigation consumes the same live authority without loading any equipment history. */
export async function readEquipmentNavigation(
	db: typeof database,
	identity: AuthorizedOrganizationIdentity,
) {
	// RSC identity already enforces approved membership and current employment.
	// Only the grant is read again; commands never accept render identity as authority.
	const administrator =
		hasOrganizationRole(identity.membershipRole, "owner") ||
		hasOrganizationRole(identity.membershipRole, "admin");
	const [grant] =
		!administrator && identity.employee
			? await db
					.select({ employeeId: equipmentOfficerGrant.employeeId })
					.from(equipmentOfficerGrant)
					.where(
						and(
							eq(equipmentOfficerGrant.organizationId, identity.organizationId),
							eq(equipmentOfficerGrant.employeeId, identity.employee.id),
							sql`${equipmentOfficerGrant.revokedAt} is null`,
						),
					)
					.limit(1)
			: [];
	return { personal: !!identity.employee, staff: administrator || !!grant };
}

export async function withEquipmentAdministration<T>(
	db: typeof database,
	actor: EquipmentActor,
	read: (tx: EquipmentTransaction) => Promise<T>,
) {
	return db.transaction(async (tx) => {
		await lockEquipmentContext(tx, actor);
		if (!(await equipmentAccess(tx, actor)).canAdminister)
			throw new AuthorizationError({
				message: "Equipment setup is not available.",
				resource: "equipment",
				action: "manage",
			});
		return read(tx);
	});
}
