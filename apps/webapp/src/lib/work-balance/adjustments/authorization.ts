import "server-only";

import { sql } from "drizzle-orm";
import type { db as globalDb } from "@/db";
import {
	type OrganizationActor,
	requireOrganizationActor,
	requireOrganizationAdmin,
} from "@/lib/auth/current-organization-actor";
import { canManageCurrentOrganizationSettings } from "@/lib/auth-helpers";
import { isUuid } from "@/lib/validations/uuid";
import { BalanceAdjustmentRefusal } from "./types";

/**
 * Who may record and cancel balance adjustments, and see them with their
 * actions in the employee's Work balance section (#993): owners and admins of
 * the active organization, for any of its employees. No approval step.
 *
 * #995 extends this with holders of an active payroll access grant for the
 * employees it covers, including employees who have left.
 */
export function requireBalanceAdjustmentWriter(): Promise<OrganizationActor> {
	return requireOrganizationAdmin(
		() =>
			new BalanceAdjustmentRefusal(
				"not_permitted",
				"Only organization owners and admins can record or cancel balance adjustments.",
			),
	);
}

/** An actor who may see an employee's balance adjustments; `canManage` also records and cancels. */
export type BalanceAdjustmentViewer = OrganizationActor & { canManage: boolean };

const notPermittedToView = () =>
	new BalanceAdjustmentRefusal(
		"not_permitted",
		"Only the employee, their managers, and owners and admins can see balance adjustments.",
	);

/**
 * Who may see an employee's balance adjustments (#996): everyone who may
 * manage them (`requireBalanceAdjustmentWriter`), the employee themselves, and
 * their managers (`employee_managers`, primary or not). Employees and managers
 * see them read-only, and only while they can use the organization. Anyone
 * else is refused without learning whether the employee exists.
 */
export async function requireBalanceAdjustmentViewer(
	database: Pick<typeof globalDb, "execute">,
	input: { employeeId: string },
): Promise<BalanceAdjustmentViewer> {
	const actor = await requireOrganizationActor(notPermittedToView);
	if (await canManageCurrentOrganizationSettings()) return { ...actor, canManage: true };
	if (!isUuid(input.employeeId)) throw notPermittedToView();

	const related = await database.execute(sql`
		SELECT 1 FROM employee subject
		WHERE subject.id = ${input.employeeId}::uuid
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
