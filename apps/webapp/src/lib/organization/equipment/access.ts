import "server-only";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { db as database } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { equipmentItem, equipmentOfficerGrant } from "@/db/schema/equipment";
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
) {
	await assertReadCommitted(tx);
	const [firstUserId, secondUserId] = [
		...new Set([actor.userId, ...(target ? [target.userId] : [])]),
	].sort();
	await holdGuard(tx, userConfigurationAccessGuard(firstUserId));
	if (secondUserId)
		await holdGuard(tx, userConfigurationAccessGuard(secondUserId));
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

/** Predicate is evaluated on the subject employee in the same statement as each read. */
export function equipmentSubjectScope(
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	now: Instant = systemClock.nowInstant(),
): SQL<boolean> {
	if (access.all) return sql`true`;
	const direct = access.employeeIds.length
		? sql`${employee.id} in (${sql.join(
				access.employeeIds.map((id) => sql`${id}::uuid`),
				sql`,`,
			)})`
		: sql`false`;
	if (!access.teamIds.length) return sql`${direct}`;
	const teams = sql.join(
		access.teamIds.map((id) => sql`${id}::uuid`),
		sql`,`,
	);
	return sql`(${direct} or (
  (${employeeHasOrganizationAccess(now)} and (
   ${employee.teamId} in (${teams}) or exists (select 1 from team_membership tm where tm.organization_id = ${employee.organizationId} and tm.employee_id = ${employee.id} and tm.team_id in (${teams}))
  )) or (not ${employeeHasOrganizationAccess(now)} and exists (
   select 1 from equipment_former_team_scope fs where fs.organization_id = ${employee.organizationId} and fs.employee_id = ${employee.id} and fs.team_ids && ARRAY[${teams}]::uuid[]
  ))
 ))`;
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
 and (not ${equipmentItem.inCustody} or not ea.received) and (${equipmentSubjectScope(access)}))`;
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
