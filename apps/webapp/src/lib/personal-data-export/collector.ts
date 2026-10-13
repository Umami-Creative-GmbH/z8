/**
 * Personal data export (#811, Organization ADR 0003): the collector interface.
 *
 * A personal data export is one ZIP of everything one organization holds about
 * one employee. It is built from **categories** (Employment, Time, Absences,
 * ...). Each category has one collector, and the pipeline knows nothing else
 * about the data:
 *
 * ```ts
 * const timeCollector: PersonalDataCollector = {
 *   category: "time",
 *   async collect(database, scope) {
 *     return { category: "time", parts: [tablePart("time_entries", COLUMNS, rows)] };
 *   },
 * };
 * ```
 *
 * Rules every collector follows:
 * - **Scope.** Load the subject employee by `employeeId` AND `organizationId`
 *   and filter every query by the organization (join through an org-scoped
 *   table when the table itself has no `organization_id`). Data of another
 *   organization the person belongs to never appears.
 * - **Kind.** `scope.kind` is `employee` (started by the employee) or `admin`
 *   (started by an org admin). Withheld data (Organization glossary) goes only
 *   into the admin export; everything else goes into both.
 * - **Rows are final.** A collector returns rows already filtered and redacted:
 *   no secrets, no technical records, no other person's data beyond what the
 *   spec allows (names of people who acted on the employee's records; opaque
 *   ids for people the employee acted on).
 * - **Values.** Plain JSON scalars only. Instants are UTC ISO strings
 *   (`instantText`), calendar days plain `YYYY-MM-DD` strings (`plainDateText`),
 *   time entries carry their own UTC offset (timekeeping rule).
 * - **Parts.** A `table` part becomes a JSON array in `<category>.json` and a
 *   CSV `<category>/<key>.csv` next to it; a `record` part is one JSON object
 *   with no CSV. Original files (documents, receipts) go in `files`.
 *
 * Add a new category by adding its key to `PERSONAL_DATA_CATEGORIES` and its
 * collector to `PERSONAL_DATA_COLLECTORS` (`collectors/index.ts`); the archive
 * writer, manifest and README pick it up from there.
 */

import type { db } from "@/db";
import type { PersonalDataExportKind } from "@/db/schema";

export type { PersonalDataExportKind } from "@/db/schema";

/** The database client a collector reads with (the global one, or a transaction). */
export type PersonalDataExportDatabase = typeof db;

/** The categories of a personal data export, in README and archive order. */
export const PERSONAL_DATA_CATEGORIES = [
	"employment",
	"time",
	"absences",
	"planning",
	"approvals",
	"travel_expenses",
	"personnel_file",
	"position_stamps",
	"notifications",
	"integrations",
	"audit_log",
	"account",
] as const;
export type PersonalDataCategoryKey = (typeof PERSONAL_DATA_CATEGORIES)[number];

/** Whose data, from which organization, for which kind of export. */
export interface PersonalDataExportScope {
	organizationId: string;
	/** The subject: whose data the export holds. */
	employeeId: string;
	/** The subject's user (their account and the rows they wrote themselves). */
	userId: string;
	kind: PersonalDataExportKind;
	/** The export being built; set by the worker. */
	exportId?: string;
	/** Who started the export; null once that user is deleted. Set by the worker. */
	requestedByUserId?: string | null;
}

export type PersonalDataValue = string | number | boolean | null;
export type PersonalDataRow = Record<string, PersonalDataValue>;

/** Table-shaped data: a JSON array plus a CSV with exactly these columns. */
export interface PersonalDataTablePart {
	kind: "table";
	/** JSON property and CSV file name; `snake_case`. */
	key: string;
	columns: readonly string[];
	rows: PersonalDataRow[];
}

/** One record: a JSON object (or null when there is none), no CSV. */
export interface PersonalDataRecordPart {
	kind: "record";
	key: string;
	record: PersonalDataRow | null;
}

export type PersonalDataPart = PersonalDataTablePart | PersonalDataRecordPart;

/** An original file copied into the archive, read only while the archive is written. */
export interface PersonalDataFile {
	/** Path inside the category's folder, e.g. `receipts/2026-03-01-taxi.pdf`. */
	path: string;
	read: () => Promise<Uint8Array>;
}

export interface CollectedCategory {
	category: PersonalDataCategoryKey;
	parts: PersonalDataPart[];
	files?: PersonalDataFile[];
}

export interface PersonalDataCollector {
	category: PersonalDataCategoryKey;
	collect(
		database: PersonalDataExportDatabase,
		scope: PersonalDataExportScope,
	): Promise<CollectedCategory>;
}

export function tablePart(
	key: string,
	columns: readonly string[],
	rows: PersonalDataRow[],
): PersonalDataTablePart {
	return { kind: "table", key, columns, rows };
}

export function recordPart(key: string, record: PersonalDataRow | null): PersonalDataRecordPart {
	return { kind: "record", key, record };
}
