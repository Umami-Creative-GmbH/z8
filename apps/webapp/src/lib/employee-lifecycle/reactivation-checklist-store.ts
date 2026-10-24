import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { employeeDeactivation } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { DeactivationApplied, DeactivationPlan } from "./deactivation/types";
import {
	buildReactivationChecklistItems,
	type ReactivationChecklist,
} from "./reactivation-checklist";
import type { LifecycleClient } from "./types";

/**
 * The re-grant checklist of the employee's latest deactivation once it was
 * reactivated, until an org admin dismisses it (#1441, D14). A deactivation
 * that is still in effect, or a later one, shows no checklist. The caller
 * checks that the actor is an org admin of `organizationId`.
 */
export async function loadReactivationChecklist(
	database: LifecycleClient,
	input: { organizationId: string; employeeId: string },
): Promise<ReactivationChecklist | null> {
	const [latest] = await database
		.select({
			id: employeeDeactivation.id,
			deactivatedAt: employeeDeactivation.deactivatedAt,
			reactivatedAt: employeeDeactivation.reactivatedAt,
			dismissedAt: employeeDeactivation.checklistDismissedAt,
			applied: employeeDeactivation.applied,
			plan: employeeDeactivation.plan,
		})
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
			),
		)
		.orderBy(desc(employeeDeactivation.deactivatedAt), desc(employeeDeactivation.createdAt))
		.limit(1);
	if (!latest?.reactivatedAt || latest.dismissedAt || !latest.applied) return null;

	const timeZone = await loadOrganizationTimezone(database, input.organizationId);
	return {
		deactivationId: latest.id,
		employeeId: input.employeeId,
		deactivatedAt: instantFromDate(new Date(latest.deactivatedAt)).toString(),
		reactivatedAt: instantFromDate(new Date(latest.reactivatedAt)).toString(),
		timeZone,
		items: buildReactivationChecklistItems({
			employeeId: input.employeeId,
			applied: latest.applied as unknown as DeactivationApplied,
			plan: (latest.plan as unknown as DeactivationPlan | null) ?? null,
		}),
	};
}

/**
 * Dismisses the checklist of a reactivated deactivation for every org admin.
 * The first dismissal wins; a deactivation still in effect is never touched.
 */
export async function dismissReactivationChecklist(
	database: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		deactivationId: string;
		actorUserId: string;
	},
): Promise<boolean> {
	const rows = await database
		.update(employeeDeactivation)
		.set({
			checklistDismissedAt: dateFromInstant(systemClock.nowInstant()),
			checklistDismissedBy: input.actorUserId,
		})
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
				eq(employeeDeactivation.id, input.deactivationId),
				isNotNull(employeeDeactivation.reactivatedAt),
				isNull(employeeDeactivation.checklistDismissedAt),
			),
		)
		.returning({ id: employeeDeactivation.id });
	return rows.length > 0;
}
