/**
 * Value helpers shared by personal data export collectors (#811): instants as
 * UTC ISO strings, calendar days as plain dates, and the names of people who
 * acted on the employee's records.
 */

import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { PersonalDataExportDatabase } from "./collector";

/** A stored instant as a UTC ISO string (`...Z`). */
export function instantText(value: Date | null | undefined): string | null {
	return value ? instantFromDate(value).toString() : null;
}

/**
 * A calendar day stored as a UTC-midnight timestamp (`mode: "date"` columns
 * such as `employee.birthday`) as a plain `YYYY-MM-DD` date.
 */
export function plainDateText(value: Date | null | undefined): string | null {
	return value ? instantFromDate(value).toZonedDateTimeISO("UTC").toPlainDate().toString() : null;
}

/** Display names of users, by id. Unknown ids are missing from the map. */
export async function loadUserNames(
	database: Pick<PersonalDataExportDatabase, "select">,
	userIds: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
	const ids = [...new Set([...userIds].filter((id): id is string => Boolean(id)))];
	if (ids.length === 0) return new Map();
	const rows = await database
		.select({
			id: user.id,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
		})
		.from(user)
		.where(inArray(user.id, ids));
	return new Map(rows.map((row) => [row.id, buildAuthUserDisplayName(row)]));
}

/** Display names of employees of one organization, by employee id. */
export async function loadEmployeeNames(
	database: PersonalDataExportDatabase,
	organizationId: string,
	employeeIds: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
	const ids = [...new Set([...employeeIds].filter((id): id is string => Boolean(id)))];
	if (ids.length === 0) return new Map();
	const rows = await database
		.select({
			id: employee.id,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
			email: user.email,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, ids)));
	return new Map(rows.map((row) => [row.id, buildAuthUserDisplayName(row)]));
}

/** The name in `names`, or null for no id or an unknown one. */
export function nameOf(names: Map<string, string>, id: string | null | undefined): string | null {
	return id ? (names.get(id) ?? null) : null;
}
