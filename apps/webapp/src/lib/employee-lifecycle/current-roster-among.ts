import { and, inArray } from "drizzle-orm";
import { employee } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "./current-roster";

// Not a uuid can't be an employee; keep it out of the uuid comparison.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which of these employees are on the organization's current roster (#1438).
 * Lists that people manage (team members, project assignments) hide former
 * employees by default and mark them when a toggle shows them; they load their
 * rows as before and ask this which ones are current. An id from another
 * organization, or one that isn't a uuid, is never current. One query for the
 * whole list, none for an empty one.
 */
export async function currentRosterAmong(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	employeeIds: Iterable<string>,
	now?: Instant,
): Promise<Set<string>> {
	const ids = [...new Set(employeeIds)].filter((id) => UUID_PATTERN.test(id));
	if (ids.length === 0) return new Set();

	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(inArray(employee.id, ids), onCurrentRoster(organizationId, employee, now)));
	return new Set(rows.map((row) => row.id));
}
