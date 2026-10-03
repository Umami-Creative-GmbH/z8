import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import type { AuthSession, CurrentEmployee } from "./auth";

export type ApprovedEmployeeContext = {
	employee: CurrentEmployee;
	membershipRole: string;
};

/** Fresh resolution for both action authorization and request-local rendering. */
export async function resolveEmployeeContext(
	session: AuthSession,
): Promise<ApprovedEmployeeContext | null> {
	const activeOrganizationId = session.session?.activeOrganizationId;
	if (!activeOrganizationId) {
		return null;
	}

	const [approvedMembership, employeeForActiveOrg] = await Promise.all([
		db.query.member.findFirst({
			columns: { id: true, role: true },
			where: and(
				eq(member.userId, session.user.id),
				eq(member.organizationId, activeOrganizationId),
				eq(member.status, "approved"),
			),
		}),
		db.query.employee.findFirst({
			where: and(
				eq(employee.userId, session.user.id),
				eq(employee.organizationId, activeOrganizationId),
				eq(employee.isActive, true),
			),
		}),
	]);

	return approvedMembership && employeeForActiveOrg
		? {
				employee: employeeForActiveOrg,
				membershipRole: approvedMembership.role,
			}
		: null;
}
