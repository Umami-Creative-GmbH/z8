import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import { canManageCurrentOrganizationSettings } from "@/lib/auth-helpers";
import {
	findActiveBalanceAdjustmentGrant,
	findBalanceAdjustmentGrant,
} from "@/lib/payroll-access/adjustment-coverage";
import { isUuid } from "@/lib/validations/uuid";
import { BalanceAdjustmentRefusal } from "./types";

/** Why the actor may record and cancel the employee's balance adjustments. */
export type BalanceAdjustmentAuthority =
	| { via: "organization_admin" }
	| { via: "payroll_access_grant"; grantId: string };

export type BalanceAdjustmentWriter = OrganizationActor & { authority: BalanceAdjustmentAuthority };

/**
 * Who may record and cancel balance adjustments, and see them with their
 * actions in the employee's Work balance section. No approval step.
 *
 * - Owners and admins of the active organization, for any of its employees (#993).
 * - With a `target`, also the holder of an active payroll access grant whose
 *   coverage for balance adjustments includes that employee, including an
 *   employee who has left, but never the holder's own record
 *   (#995, `findBalanceAdjustmentGrant`). Without a
 *   target, as for an organization-wide action, only owners and admins pass.
 *
 * The employee and their managers only see them: `requireBalanceAdjustmentViewer` (#996).
 */
export async function requireBalanceAdjustmentWriter(target?: {
	employeeId: string;
}): Promise<BalanceAdjustmentWriter> {
	const actor = await requireOrganizationActor(notPermitted);
	const authority = await findWriterAuthority(actor, target);
	if (!authority) throw notPermitted();
	return { ...actor, authority };
}

async function findWriterAuthority(
	actor: OrganizationActor,
	target: { employeeId: string } | undefined,
): Promise<BalanceAdjustmentAuthority | null> {
	if (await canManageCurrentOrganizationSettings()) return { via: "organization_admin" };
	if (!target) return null;
	const grant = await findBalanceAdjustmentGrant(db, {
		organizationId: actor.organizationId,
		actorUserId: actor.userId,
		employeeId: target.employeeId,
	});
	return grant ? { via: "payroll_access_grant", grantId: grant.grantId } : null;
}

/**
 * Who may upload opening balances in bulk (#999): owners and admins of the
 * active organization, and the holder of an active payroll access grant in it.
 * Which rows a holder may write is decided per row by the upload (the grant's
 * coverage for balance adjustments, never the holder's own record).
 */
export async function requireOpeningBalanceUploader(): Promise<BalanceAdjustmentWriter> {
	const actor = await requireOrganizationActor(notPermitted);
	if (await canManageCurrentOrganizationSettings()) {
		return { ...actor, authority: { via: "organization_admin" } };
	}
	const grant = await findActiveBalanceAdjustmentGrant(db, {
		organizationId: actor.organizationId,
		actorUserId: actor.userId,
	});
	if (!grant) throw notPermitted();
	return { ...actor, authority: { via: "payroll_access_grant", grantId: grant.grantId } };
}

/**
 * The audit metadata for an adjustment the actor writes: a grant holder's
 * entries name the grant; an owner's or admin's entries carry none.
 */
export function balanceAdjustmentAuditMetadata(
	authority: BalanceAdjustmentAuthority,
): Record<string, unknown> | null {
	return authority.via === "payroll_access_grant"
		? { via: "payroll_access_grant", grantId: authority.grantId }
		: null;
}

function notPermitted() {
	return new BalanceAdjustmentRefusal(
		"not_permitted",
		"Only organization owners and admins, and payroll staff for the employees their grant covers, can record or cancel balance adjustments.",
	);
}

/**
 * Whether the signed-in user may record balance adjustments for the employee
 * in the given organization: the same rule as
 * `requireBalanceAdjustmentWriter({ employeeId })` (owners and admins, and a
 * payroll grant holder covering the employee), without throwing. Other
 * screens use it to decide whether to offer a payout, such as the final payout
 * in the offboarding review (#1002); recording re-checks.
 */
export async function mayWriteBalanceAdjustments(input: {
	organizationId: string;
	employeeId: string;
}): Promise<boolean> {
	try {
		const writer = await requireBalanceAdjustmentWriter({ employeeId: input.employeeId });
		return writer.organizationId === input.organizationId;
	} catch (error) {
		if (error instanceof BalanceAdjustmentRefusal) return false;
		throw error;
	}
}

/** An actor who may see an employee's balance adjustments; `canManage` also records and cancels. */
export type BalanceAdjustmentViewer = OrganizationActor & { canManage: boolean };

const notPermittedToView = () =>
	new BalanceAdjustmentRefusal(
		"not_permitted",
		"Only the employee, their managers, and those who may record adjustments can see them.",
	);

/**
 * Who may see an employee's balance adjustments (#996): everyone who may
 * record and cancel them (`requireBalanceAdjustmentWriter`, then `canManage`),
 * the employee themselves, and their managers (`employee_managers`, primary or
 * not). Employees and managers see them read-only, and only while they can use
 * the organization. Anyone else is refused without learning whether the
 * employee exists.
 */
export async function requireBalanceAdjustmentViewer(
	database: Pick<typeof db, "execute">,
	input: { employeeId: string },
): Promise<BalanceAdjustmentViewer> {
	const actor = await requireOrganizationActor(notPermittedToView);
	const target = isUuid(input.employeeId) ? { employeeId: input.employeeId } : undefined;
	if (await findWriterAuthority(actor, target)) return { ...actor, canManage: true };
	if (!target) throw notPermittedToView();

	const related = await database.execute(sql`
		SELECT 1 FROM employee subject
		WHERE subject.id = ${target.employeeId}::uuid
			AND subject.organization_id = ${actor.organizationId}
			AND (
				(
					subject.user_id = ${actor.userId}
					AND subject.is_active = true
					AND NOT employee_departure_denies_access(subject.organization_id, subject.id, now())
				)
				OR EXISTS (
					SELECT 1 FROM employee_managers link
					JOIN employee manager ON manager.id = link.manager_id
					WHERE link.employee_id = subject.id
						AND manager.organization_id = ${actor.organizationId}
						AND manager.user_id = ${actor.userId}
						AND manager.is_active = true
						AND NOT employee_departure_denies_access(manager.organization_id, manager.id, now())
				)
			)
		LIMIT 1
	`);
	if (related.rows.length === 0) throw notPermittedToView();
	return { ...actor, canManage: false };
}
