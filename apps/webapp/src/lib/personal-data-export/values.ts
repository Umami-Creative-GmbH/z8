/**
 * Value helpers shared by personal data export collectors (#811): instants as
 * UTC ISO strings, calendar days as plain dates, the names of people who
 * acted on the employee's records, the subject employee, and stored JSON.
 */

import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { PersonalDataExportDatabase, PersonalDataExportScope } from "./collector";

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

/** A name lookup by id: null for no id or an unknown one. */
export type NameLookup = (id: string | null | undefined) => string | null;

/** `loadUserNames` as a lookup function. */
export async function userNameLookup(
	database: Pick<PersonalDataExportDatabase, "select">,
	userIds: Iterable<string | null | undefined>,
): Promise<NameLookup> {
	const names = await loadUserNames(database, userIds);
	return (id) => nameOf(names, id);
}

/** `loadEmployeeNames` as a lookup function. */
export async function employeeNameLookup(
	database: PersonalDataExportDatabase,
	organizationId: string,
	employeeIds: Iterable<string | null | undefined>,
): Promise<NameLookup> {
	const names = await loadEmployeeNames(database, organizationId, employeeIds);
	return (id) => nameOf(names, id);
}

// ============================================
// THE SUBJECT
// ============================================

export class PersonalDataSubjectNotFoundError extends Error {
	constructor() {
		super("The export's employee no longer exists in its organization");
		this.name = "PersonalDataSubjectNotFoundError";
	}
}

/**
 * The export's subject employee, loaded by id AND organization (collector.ts,
 * "Scope"). Throws `PersonalDataSubjectNotFoundError` when it is gone.
 */
export async function loadSubjectEmployee(
	database: Pick<PersonalDataExportDatabase, "select">,
	scope: Pick<PersonalDataExportScope, "organizationId" | "employeeId">,
): Promise<{ id: string; userId: string; teamId: string | null }> {
	const [subject] = await database
		.select({ id: employee.id, userId: employee.userId, teamId: employee.teamId })
		.from(employee)
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.limit(1);
	if (!subject) throw new PersonalDataSubjectNotFoundError();
	return subject;
}

// ============================================
// STORED JSON
// ============================================

/** A JSON text column, typed as its parsed shape but read as stored text. */
export function jsonText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** A JSON text column (or an already parsed value) as an object, else null. */
export function jsonObject(value: unknown): Record<string, unknown> | null {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: null;
}
