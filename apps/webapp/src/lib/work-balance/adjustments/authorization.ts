import "server-only";

import { db } from "@/db";
import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import { canManageCurrentOrganizationSettings } from "@/lib/auth-helpers";
import { findBalanceAdjustmentGrant } from "@/lib/payroll-access/adjustment-coverage";
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
 *   employee who has left (#995, `findBalanceAdjustmentGrant`). Without a
 *   target, as for an organization-wide action, only owners and admins pass.
 *
 * #996 adds read-only access for the employee and their managers.
 */
export async function requireBalanceAdjustmentWriter(target?: {
	employeeId: string;
}): Promise<BalanceAdjustmentWriter> {
	const actor = await requireOrganizationActor(notPermitted);
	if (await canManageCurrentOrganizationSettings()) {
		return { ...actor, authority: { via: "organization_admin" } };
	}
	if (target) {
		const grant = await findBalanceAdjustmentGrant(db, {
			organizationId: actor.organizationId,
			actorUserId: actor.userId,
			employeeId: target.employeeId,
		});
		if (grant) {
			return { ...actor, authority: { via: "payroll_access_grant", grantId: grant.grantId } };
		}
	}
	throw notPermitted();
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
