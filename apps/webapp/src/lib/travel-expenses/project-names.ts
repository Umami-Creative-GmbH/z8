import { and, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { customer, project } from "@/db/schema";

type Reader = Pick<typeof appDb, "select">;

/**
 * Current names of the given projects of one organization, by id (#617): what
 * the employee's submission review step shows. Frozen revisions keep their own
 * names; this is only for drafts. Ids of other organizations are never named.
 */
export async function loadProjectNames(
	reader: Reader,
	organizationId: string,
	projectIds: readonly (string | null | undefined)[],
): Promise<Record<string, { name: string; customerName: string | null }>> {
	const ids = [...new Set(projectIds.filter((id): id is string => Boolean(id)))];
	if (ids.length === 0) return {};
	const rows = await reader
		.select({ id: project.id, name: project.name, customerName: customer.name })
		.from(project)
		.leftJoin(
			customer,
			and(eq(customer.id, project.customerId), eq(customer.organizationId, project.organizationId)),
		)
		.where(and(eq(project.organizationId, organizationId), inArray(project.id, ids)));
	return Object.fromEntries(
		rows.map((row) => [row.id, { name: row.name, customerName: row.customerName }]),
	);
}
