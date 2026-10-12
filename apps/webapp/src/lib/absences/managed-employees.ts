import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";

/**
 * The employees a manager is assigned to in the organization (the team
 * absence page's manager rule, which the deputy surfaces of spec #802 share):
 * who a manager may record absences and change deputies for, and whose
 * absence category they see. Optionally narrowed to some employees.
 */
export async function loadManagedEmployeeIds(
	executor: Pick<typeof db, "select">,
	input: { organizationId: string; managerEmployeeId: string; employeeIds?: readonly string[] },
): Promise<Set<string>> {
	if (input.employeeIds?.length === 0) return new Set();
	const rows = await executor
		.select({ employeeId: employeeManagers.employeeId })
		.from(employeeManagers)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeManagers.employeeId),
				eq(employee.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(employeeManagers.managerId, input.managerEmployeeId),
				input.employeeIds
					? inArray(employeeManagers.employeeId, [...input.employeeIds])
					: undefined,
			),
		);
	return new Set(rows.map((row) => row.employeeId));
}
