"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";

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
	if (activeOrganizationId) {
		const employeeForActiveOrg = await queryClient.query.employee.findFirst({
			where: and(
				eq(employee.userId, userId),
				eq(employee.organizationId, activeOrganizationId),
				eq(employee.isActive, true),
			),
		});

		if (employeeForActiveOrg) {
			return employeeForActiveOrg;
		}
	}

	return queryClient.query.employee.findFirst({
		where: and(eq(employee.userId, userId), eq(employee.isActive, true)),
	});
}

/**
 * Get current employee from session
 * Uses activeOrganizationId to get the correct employee record for the active org
 */
export async function getCurrentEmployee() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	return findCurrentEmployeeByUserId(db, session.user.id, session.session?.activeOrganizationId);
}
