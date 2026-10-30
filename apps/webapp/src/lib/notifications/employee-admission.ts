import "server-only";

import { db } from "@/db";
import type { RequestSession } from "@/lib/auth/request-session";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";

/** Notifications retain their employee requirement, including for member-only admins. */
export async function mayUseEmployeeNotifications(
	session: NonNullable<RequestSession>,
	organizationId: string,
): Promise<boolean> {
	if (!(await canAccessOrganization(session.session, organizationId)))
		return false;
	const access = await resolveEmployeeOrganizationAccess(db, {
		userId: session.user.id,
		organizationId,
	});
	return access.allowed && access.employeeId !== null;
}
