import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import type { Transaction } from "@/lib/time-tracking/work-transaction";

export type DemoEmployee = typeof employee.$inferSelect;

/**
 * Runs one runtime demo configuration batch under the #264 configuration/access
 * protocol (#318).
 *
 * Demo setup and cleanup write organization-wide manual dependencies (projects,
 * work category sets and their assignments, change policies) together with
 * per-user facts (team placement, manager relations, membership and employee
 * rows). The batch therefore takes exclusive organization configuration
 * protection, then the sorted exclusive guards of every employee's user in the
 * organization, before its first write. The employees are discovered from
 * current rows and confirmed under protection; an employee added meanwhile
 * restarts the batch. `mutation` receives exactly the confirmed employees, so it
 * never writes a fact of a user it did not protect, and never an employee of
 * another organization.
 */
export async function withDemoConfigurationMutation<T>(
	organizationId: string,
	mutation: (transaction: Transaction, employees: DemoEmployee[]) => Promise<T>,
	options: { userIds?: readonly string[] } = {},
): Promise<T> {
	let employees: DemoEmployee[] = [];
	return withAuthorizationMutation(
		{
			organizationId,
			organizationWide: true,
			userIds: options.userIds,
			route: async (transaction) => {
				employees = await transaction.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
				});
				return { userIds: employees.map((row) => row.userId) };
			},
		},
		(transaction) => mutation(transaction, employees),
		db,
	);
}
