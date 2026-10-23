import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as rootDatabase } from "@/db";
import { employee } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeLeftAt, formerSinceDate, isFormerEmployee } from "./current-roster";

/**
 * Whether an employee has left, and when (#1439, Organization ADR 0006). A
 * former employee whose date isn't recorded (deactivated before the moment was
 * stored) has `leftAt` and `leftOn` null: views show "Date not recorded".
 */
export type EmployeeLeftOn =
	| { former: false }
	| { former: true; leftAt: Instant | null; leftOn: Temporal.PlainDate | null };

/**
 * When one employee of the organization left: the departure cutoff for a
 * departure, the stored instant for a deactivation, the later of the two after a
 * rehire. `leftOn` is the organization-local date. Null for an employee of
 * another organization or an unknown id.
 */
export async function readEmployeeLeftOn(
	database: Pick<typeof rootDatabase, "select">,
	input: { organizationId: string; employeeId: string; now?: Instant },
): Promise<EmployeeLeftOn | null> {
	const [row] = await database
		.select({
			former: isFormerEmployee(employee, input.now),
			leftAt: employeeLeftAt(employee, input.now),
			leftOn: formerSinceDate(employee, input.now),
		})
		.from(employee)
		.where(and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)))
		.limit(1);
	if (!row) return null;
	if (!row.former) return { former: false };
	return {
		former: true,
		leftAt: row.leftAt ? Temporal.Instant.from(row.leftAt) : null,
		leftOn: row.leftOn ? Temporal.PlainDate.from(row.leftOn) : null,
	};
}
