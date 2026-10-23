import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { employee } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

/** The employee columns the roster rule reads: `employee` itself or an alias of it. */
export type RosterEmployeeColumns = {
	id: AnyPgColumn;
	organizationId: AnyPgColumn;
	isActive: AnyPgColumn;
};

/**
 * The current roster (Organization glossary, ADR 0006): the organization's
 * employees who are not former employees. Everything that answers "who works
 * here now" filters with it: teams, presence, planning, pickers, recipients,
 * counts. Views of the past keep former employees and mark them with
 * `isFormerEmployee` instead (#1438).
 *
 * Scoped to the organization, and a due departure counts the same as a
 * deactivation, exactly as `employeeHasOrganizationAccess` decides access. Pass
 * an alias when the query joins `employee` more than once.
 */
export function onCurrentRoster(
	organizationId: string,
	columns: RosterEmployeeColumns = employee,
	now?: Instant,
): SQL<boolean> {
	return sql<boolean>`(${columns.organizationId} = ${organizationId} AND ${isCurrent(columns, now)})`;
}

/** True for a former employee, so views of the past can mark them as former. */
export function isFormerEmployee(
	columns: RosterEmployeeColumns = employee,
	now?: Instant,
): SQL<boolean> {
	return sql<boolean>`(NOT ${isCurrent(columns, now)})`;
}

/** The instant a roster or access check is evaluated at: `now`, or the database's own now. */
export function rosterCheckInstant(now?: Instant): SQL {
	return now ? sql`${dateFromInstant(now)}::timestamptz` : sql`now()`;
}

function isCurrent(columns: RosterEmployeeColumns, now?: Instant): SQL {
	return sql`(${columns.isActive} = true AND NOT employee_departure_denies_access(${columns.organizationId}, ${columns.id}, ${rosterCheckInstant(now)}))`;
}
