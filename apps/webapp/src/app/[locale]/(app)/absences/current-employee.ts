"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getRequestSession } from "@/lib/auth/request-session";

type EmployeeQueryClient = {
	query: {
		employee: {
			findFirst: typeof db.query.employee.findFirst;
		};
	};
};

export async function findCurrentEmployeeByUserId(
	queryClient: EmployeeQueryClient,
	userId: string,
	activeOrganizationId?: string | null,
) {
	if (!activeOrganizationId) {
		return null;
	}

	const employeeForActiveOrg = await queryClient.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, activeOrganizationId),
			eq(employee.isActive, true),
		),
	});

	return employeeForActiveOrg ?? null;
}

/**
 * Get current employee from session
 * Uses activeOrganizationId to get the correct employee record for the active org
 */
export async function getCurrentEmployee() {
	const session = await getRequestSession();
	if (!session?.user) {
		return null;
	}

	return findCurrentEmployeeByUserId(db, session.user.id, session.session?.activeOrganizationId);
}
