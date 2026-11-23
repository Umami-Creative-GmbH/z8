import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

/** Refuses with `NotFoundError` unless the employee belongs to the organization. */
export async function loadEmployeeInOrganization(
	db: Pick<DatabaseClient, "select">,
	scope: { readonly organizationId: string; readonly employeeId: string },
): Promise<void> {
	const [row] = await db
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.limit(1);
	if (!row) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: scope.employeeId,
		});
	}
}
