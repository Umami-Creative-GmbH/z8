import { and, eq, type SQL, sql } from "drizzle-orm";
import type { db } from "@/db";
import { customer, project } from "@/db/schema";

/**
 * A project's customer for Billable Time (#768). Customers are only soft-deleted
 * (`customer.is_active = false`); a project whose customer was deleted is a
 * project *without customer*, exactly like one whose customer was removed: its
 * work cannot be billable, it has no billable default, and its billable work
 * shows as without customer and is never handed off.
 *
 * Every reader and writer that asks "does this project have a customer?" uses
 * these predicates, never `project.customer_id IS NOT NULL` alone.
 */

/** Whether the `project` row in scope has an active customer of its organization. */
export function projectHasActiveCustomerSql(): SQL<boolean> {
	return sql<boolean>`exists (select 1 from ${customer} where ${customer.id} = ${project.customerId} and ${customer.organizationId} = ${project.organizationId} and ${customer.isActive})`;
}

/** The `project` row's customer id while that customer is active, else null. */
export function activeProjectCustomerIdSql(): SQL<string | null> {
	return sql<
		string | null
	>`case when ${projectHasActiveCustomerSql()} then ${project.customerId} end`.mapWith(
		project.customerId,
	);
}

type Reader = Pick<typeof db, "select">;

/**
 * The project's active customer id in its organization; null for a project
 * without customer, with a deleted customer, or of another organization.
 */
export async function readProjectActiveCustomerId(
	reader: Reader,
	organizationId: string,
	projectId: string,
): Promise<string | null> {
	const [row] = await reader
		.select({ customerId: activeProjectCustomerIdSql() })
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
		.limit(1);
	return row?.customerId ?? null;
}
