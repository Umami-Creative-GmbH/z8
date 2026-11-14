"use server";

import { db } from "@/db";
import { getAuthContext } from "@/lib/auth-helpers";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";

/** Why the viewer has no employee in their active organization, when it is worth saying. */
export type NoEmployeeReason = "former_employee" | null;

/**
 * "former_employee" when the viewer holds an approved membership in their
 * active organization but their employment there ended: a former employee who
 * regained the membership and needs a rehire (#1672, spec #1664 decision 4).
 * Reads only the viewer's own state in the session's organization.
 */
export async function getNoEmployeeReason(): Promise<NoEmployeeReason> {
	const context = await getAuthContext();
	const organizationId = context?.session.activeOrganizationId;
	if (!context || !organizationId || context.employee) return null;
	const access = await resolveEmployeeOrganizationAccess(db, {
		userId: context.user.id,
		organizationId,
	});
	return !access.allowed && access.reason === "offboarded" ? "former_employee" : null;
}
