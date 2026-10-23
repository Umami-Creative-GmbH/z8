import { and, inArray } from "drizzle-orm";
import { employee } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "./current-roster";

/**
 * Which of these employees are on the organization's current roster (#1438).
 * Lists that people manage (team members, project assignments) hide former
 * employees by default and mark them when a toggle shows them; they load their
 * rows as before and ask this which ones are current. An id from another
 * organization is never current.
 */
export async function currentRosterAmong(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	employeeIds: Iterable<string>,
	now?: Instant,
): Promise<Set<string>> {
	const ids = [...new Set(employeeIds)];
	if (ids.length === 0) return new Set();

	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(inArray(employee.id, ids), onCurrentRoster(organizationId, employee, now)));
	return new Set(rows.map((row) => row.id));
}
