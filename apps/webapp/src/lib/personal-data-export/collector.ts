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
 *   fields: timeFieldGuide, // see "Field guide" below
 * };
 * ```
 *
 * Rules every collector follows:
 * - **Scope.** Load the subject employee by `employeeId` AND `organizationId`
 *   with `loadSubjectEmployee` (values.ts; it throws
 *   `PersonalDataSubjectNotFoundError` when the employee is gone) and filter
 *   every query by the organization (join through an org-scoped table when
 *   the table itself has no `organization_id`). Data of another organization
 *   the person belongs to never appears.
 * - **Read only.** Collectors only read, with one exception: the position
 *   stamps collector writes one `data_export` access-log entry when an admin
 *   export holds stamps (#831 D4), in its own transaction, once per export.
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
 * - **Field guide.** The README explains every part and every field of the
 *   archive (Art. 15), in the employee's language. Each collector declares
 *   that explanation next to its parts, as `fields`: a function of the README
 *   translator returning, per part key, a one-line `summary` of what the part
 *   holds and one sentence per column (table) or property (record):
 *
 *   ```ts
 *   // collectors/time-fields.ts (abridged)
 *   export const timeFieldGuide: PersonalDataFieldGuide = (t) => ({
 *     time_entries: {
 *       summary: t("personalDataExport.readme.fields.time.timeEntries.summary", "Every clock-in, ..."),
 *       fields: {
 *         ...commonFieldExplanations(t, ["id", "created_at"]),
 *         notes: t("personalDataExport.readme.fields.time.timeEntries.notes", "The note written on the entry."),
 *       },
 *     },
 *   });
 *   ```
 *
 *   Write one literal `t(key, englishDefault)` call per text (the Tolgee
 *   extractor reads only those; the parameter must be named `t`). Keys are
 *   `personalDataExport.readme.fields.<category>.<partKeyCamel>.summary` and
 *   `...<partKeyCamel>.<fieldCamel>` per field (no field may be named
 *   `summary`); columns every collector shares (ids, who and when) come from
 *   `commonFieldExplanations`. Keep the guide in its own
 *   `collectors/<category>-fields.ts`; `collectors/employment-fields.ts` is
 *   the worked example.
 *   The README renders only the parts and fields that are in the archive, so
 *   describing a withheld (admin-only) part or column in the guide never
 *   shows it in an employee export; never name withheld values or their
 *   markers (such as `hr_only`) in a text an employee export shows.
 *   `findUnexplainedFields` (readme.ts) lists every part and column a guide
 *   misses; the README integration test runs every registered collector in
 *   both kinds of export and requires it to be empty.
 *
 * Add a new category by adding its key to `PERSONAL_DATA_CATEGORIES` and its
 * collector to `PERSONAL_DATA_COLLECTORS` (`collectors/index.ts`); the archive
 * writer and manifest pick it up from there. The README's category list also
 * needs a case for it in `categoryDescription` (readme.ts); the type checker
 * asks for it.
 */

import type { db } from "@/db";
import type { PersonalDataExportKind } from "@/db/schema";
import type { ReadmeTranslate } from "./readme";

export type { PersonalDataExportKind } from "@/db/schema";

/** The database client a collector reads with (the global one, or a transaction). */
export type PersonalDataExportDatabase = typeof db;

/** Read access only: the global client or a collector's own transaction. */
export type PersonalDataExportReader = Pick<
	PersonalDataExportDatabase,
	"select"
>;

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
	"driving_licence",
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

/** The README's explanation of one part: what it holds, and each field. */
export interface PersonalDataPartGuide {
	summary: string;
	/** One sentence per column (table part) or property (record part), by field name. */
	fields: Readonly<Record<string, string>>;
}

/**
 * The README's explanation of a category's parts, by part key, in the
 * translator's language. Describe every part the collector can return,
 * withheld ones included (see the header).
 */
export type PersonalDataFieldGuide = (
	t: ReadmeTranslate,
) => Record<string, PersonalDataPartGuide>;

export interface PersonalDataCollector {
	category: PersonalDataCategoryKey;
	collect(
		database: PersonalDataExportDatabase,
		scope: PersonalDataExportScope,
	): Promise<CollectedCategory>;
	/** Explains every part and field in the README; see "Field guide" above. */
	fields: PersonalDataFieldGuide;
}

/** Fields many parts share, explained once. */
export const COMMON_FIELDS = [
	"id",
	"created_at",
	"created_by",
	"updated_at",
	"updated_by",
	"assigned_at",
	"assigned_by",
	"effective_from",
	"effective_to",
] as const;
export type CommonField = (typeof COMMON_FIELDS)[number];

/** The explanations of the named shared fields, for a part's `fields`. */
export function commonFieldExplanations(
	t: ReadmeTranslate,
	names: readonly CommonField[],
): Record<string, string> {
	const all: Record<CommonField, () => string> = {
		id: () =>
			t(
				"personalDataExport.readme.fields.common.id",
				"The record's ID in the app, so other files can refer to it.",
			),
		created_at: () =>
			t(
				"personalDataExport.readme.fields.common.createdAt",
				"When the record was created.",
			),
		created_by: () =>
			t(
				"personalDataExport.readme.fields.common.createdBy",
				"Who created the record.",
			),
		updated_at: () =>
			t(
				"personalDataExport.readme.fields.common.updatedAt",
				"When the record was last changed.",
			),
		updated_by: () =>
			t(
				"personalDataExport.readme.fields.common.updatedBy",
				"Who last changed the record.",
			),
		assigned_at: () =>
			t(
				"personalDataExport.readme.fields.common.assignedAt",
				"When it was assigned to you.",
			),
		assigned_by: () =>
			t(
				"personalDataExport.readme.fields.common.assignedBy",
				"Who assigned it to you.",
			),
		effective_from: () =>
			t(
				"personalDataExport.readme.fields.common.effectiveFrom",
				"When it took effect.",
			),
		effective_to: () =>
			t(
				"personalDataExport.readme.fields.common.effectiveTo",
				"When it stopped applying; empty while it still applies.",
			),
	};
	return Object.fromEntries(names.map((name) => [name, all[name]()]));
}

export function tablePart(
	key: string,
	columns: readonly string[],
	rows: PersonalDataRow[],
): PersonalDataTablePart {
	return { kind: "table", key, columns, rows };
}

export function recordPart(
	key: string,
	record: PersonalDataRow | null,
): PersonalDataRecordPart {
	return { kind: "record", key, record };
}
