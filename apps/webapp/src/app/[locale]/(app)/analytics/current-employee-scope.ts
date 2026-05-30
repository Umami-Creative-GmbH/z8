import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { employee } from "@/db/schema";

type EmployeeQueryClient = {
	query: {
		employee: {
			findFirst: typeof db.query.employee.findFirst;
		};
	};
};

export async function findAnalyticsEmployeeByUserId(
	queryClient: EmployeeQueryClient,
	userId: string,
	activeOrganizationId?: string | null,
) {
	if (!activeOrganizationId) {
		return null;
	}

	return await queryClient.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, activeOrganizationId),
			eq(employee.isActive, true),
		),
	});
}
