/**
 * The README of a personal data export (#811), in the employee's UI language
 * (else the organization's default), also when an admin started the export.
 * Keys live in the `common` namespace under `personalDataExport.readme.*`.
 *
 * Sections: what the archive is, its files and formats, every part and field
 * (from the collectors' field guides), and the Art. 15 information: who can
 * access the data, how long it is kept, and the employee's rights. The
 * employee export also says that a complete copy can be requested from the
 * admins (Organization ADR 0003).
 *
 * The README must never reveal whether withheld data exists: it is built only
 * from the organization's configuration, the people with access, and the
 * parts actually in the archive, never from the employee's withheld records.
 */

import { createLogger } from "@/lib/logger";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";
import { loadNamespaces, TolgeeBase } from "@/tolgee/shared";
import type {
	CollectedCategory,
	PersonalDataCategoryKey,
	PersonalDataCollector,
	PersonalDataExportKind,
	PersonalDataFieldGuide,
} from "./collector";

const logger = createLogger("PersonalDataExportReadme");

export type ReadmeTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/** Tolgee's `t` in `locale`; every text falls back to its English default. */
export async function loadReadmeTranslator(locale: string): Promise<ReadmeTranslate> {
	try {
		const staticData = await loadNamespaces(locale, ["common"]);
		const tolgee = TolgeeBase().init({ language: locale, staticData });
		await tolgee.run();
		return (key, defaultValue, params) => tolgee.t({ key, defaultValue, params });
	} catch (error) {
		logger.warn({ locale, error }, "README translations unavailable; writing English defaults");
		return fallbackReadmeTranslator;
	}
}

/**
 * English defaults with `{param}` placeholders and simple ICU plurals
 * (`{n, plural, one {# year} other {# years}}`) filled in.
 */
export const fallbackReadmeTranslator: ReadmeTranslate = (_key, defaultValue, params) =>
	defaultValue
		.replace(
			/\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g,
			(match, name: string, one: string, other: string) => {
				if (!params || !(name in params)) return match;
				const count = Number(params[name]);
				return (count === 1 ? one : other).replace(/#/g, String(count));
			},
		)
		.replace(/\{(\w+)\}/g, (match, name: string) =>
			params && name in params ? String(params[name]) : match,
		);

/** One static `t()` per category, so the extractor reads every default. */
function categoryDescription(
	category: PersonalDataCategoryKey,
	kind: PersonalDataExportKind,
	t: ReadmeTranslate,
): string {
	switch (category) {
		case "employment":
			return t(
				"personalDataExport.readme.category.employment",
				"Your employee record and profile, employment periods and departure, employment terms with your hourly wage and its history, teams, managers, locations, skills, project assignments, roles, groups, cost centre and every policy assigned to you.",
			);
		case "time":
			return t(
				"personalDataExport.readme.category.time",
				"Your time entries, work periods and corrections, breaks, automatic clock-outs, compliance exceptions, work-policy violations, surcharges, balances and balance adjustments.",
			);
		case "absences":
			return t(
				"personalDataExport.readme.category.absences",
				"Your absences, vacation allowances and vacation adjustments.",
			);
		case "planning":
			return t("personalDataExport.readme.category.planning", "Your shifts and shift requests.");
		case "approvals":
			return t(
				"personalDataExport.readme.category.approvals",
				"Your own requests and period submissions, and the decisions you made on other people's requests.",
			);
		case "travel_expenses":
			return t(
				"personalDataExport.readme.category.travelExpenses",
				"Your travel expense claims, reports, items, settlements and receipts.",
			);
		case "personnel_file":
			return t(
				"personalDataExport.readme.category.personnelFile",
				"The documents in your personnel file, as original files.",
			);
		case "position_stamps":
			return t(
				"personalDataExport.readme.category.positionStamps",
				"Your position stamps, your consent history and who viewed your positions.",
			);
		case "notifications":
			return t("personalDataExport.readme.category.notifications", "Your notification history.");
		case "integrations":
			return t(
				"personalDataExport.readme.category.integrations",
				"Your calendar connections, calendar feed, linked chat accounts and kiosk PIN status.",
			);
		case "audit_log":
			return t(
				"personalDataExport.readme.category.auditLog",
				"Audit log entries about you and entries you performed.",
			);
		case "account":
			// The admin export holds only the name and email of the account (#1166).
			if (kind === "admin") {
				return t(
					"personalDataExport.readme.category.accountAdmin",
					"The name and email address of your user account.",
				);
			}
			return t(
				"personalDataExport.readme.category.account",
				"Your user account: sessions, sign-in methods, security settings, preferences and devices.",
			);
	}
}

export interface PersonalDataReadmeInput {
	t: ReadmeTranslate;
	kind: PersonalDataExportKind;
	organizationName: string;
	employeeName: string;
	/** UTC ISO instant the data was read. */
	exportedAt: string;
	categories: readonly PersonalDataCategoryKey[];
	/** Categories with CSV files next to their JSON; all of them when omitted. */
	csvCategories?: readonly PersonalDataCategoryKey[];
	/** The parts in the archive and their field guides (`readmeContentsOf`). */
	contents?: PersonalDataReadmeContents;
	/** Who can access the employee's data (`loadPersonalDataReadmeFacts`). */
	access: PersonalDataReadmeAccess;
	retention: PersonalDataReadmeRetention;
}

export type PayrollCoverage = "all" | "employee" | "team";

/** The people of the organization who can access the employee's data, besides the employee. */
export interface PersonalDataReadmeAccess {
	ownersAndAdmins: readonly { name: string; role: "owner" | "admin" }[];
	/** Direct managers, and people whose team permissions cover the employee's teams. */
	managers: readonly { name: string; via: "direct" | "team" }[];
	/** With the document categories of the employee's file they manage. */
	personnelFileOfficers: readonly {
		name: string;
		categories: readonly DocumentCategory[];
	}[];
	/** With what their grant covers: every employee, the employee by name, or one of their teams. */
	payrollOfficers: readonly {
		name: string;
		covers: readonly PayrollCoverage[];
	}[];
	expenseOfficers: readonly {
		name: string;
		canExport: boolean;
		canRecordReimbursements: boolean;
	}[];
}

export interface PersonalDataReadmeRetention {
	/** The organization's retention period per document category; missing = none set. */
	documentYears: Partial<Record<DocumentCategory, number>>;
	auditLogDays: number;
}

/** One part as it is in the archive: its key, shape and field names. */
export interface PersonalDataReadmePart {
	key: string;
	kind: "table" | "record";
	fields: readonly string[];
}

export type PersonalDataReadmeContents = Partial<
	Record<
		PersonalDataCategoryKey,
		{
			parts: readonly PersonalDataReadmePart[];
			guide: PersonalDataFieldGuide | undefined;
		}
	>
>;

/**
 * The parts each collected category wrote (field names only, never values),
 * with its collector's field guide. A record part's fields are its record's
 * properties, or the guide's when the record is null.
 */
export function readmeContentsOf(
	categories: readonly CollectedCategory[],
	collectors: readonly PersonalDataCollector[],
): PersonalDataReadmeContents {
	const contents: PersonalDataReadmeContents = {};
	const collectorsByCategory = new Map(
		collectors.toReversed().map((collector) => [collector.category, collector]),
	);
	for (const category of categories) {
		const guide = collectorsByCategory.get(category.category)?.fields;
		const guideFields = (key: string) =>
			Object.keys(guide?.(fallbackReadmeTranslator)[key]?.fields ?? {});
		contents[category.category] = {
			guide,
			parts: category.parts.map((part) => ({
				key: part.key,
				kind: part.kind,
				fields:
					part.kind === "table"
						? part.columns
						: part.record
							? Object.keys(part.record)
							: guideFields(part.key),
			})),
		};
	}
	return contents;
}

/** Every `category/part` or `category/part.field` of the archive its guide does not explain. */
export function findUnexplainedFields(contents: PersonalDataReadmeContents): string[] {
	const missing: string[] = [];
	for (const [category, entry] of Object.entries(contents)) {
		if (!entry) continue;
		const guide = entry.guide?.(fallbackReadmeTranslator) ?? {};
		for (const part of entry.parts) {
			const partGuide = guide[part.key];
			if (!partGuide?.summary) {
				missing.push(`${category}/${part.key}`);
				continue;
			}
			for (const field of part.fields) {
				if (!partGuide.fields[field]) missing.push(`${category}/${part.key}.${field}`);
			}
		}
	}
	return missing;
}

function documentCategoryName(category: DocumentCategory, t: ReadmeTranslate): string {
	switch (category) {
		case "contract":
			return t("personalDataExport.readme.documentCategory.contract", "Contracts");
		case "payslip":
			return t("personalDataExport.readme.documentCategory.payslip", "Payslips");
		case "certificate":
			return t("personalDataExport.readme.documentCategory.certificate", "Certificates");
		case "sick_note":
			return t("personalDataExport.readme.documentCategory.sickNote", "Sick notes");
		case "other":
			return t("personalDataExport.readme.documentCategory.other", "Other documents");
	}
}

function renderFields(
	lines: string[],
	heading: (text: string) => void,
	input: PersonalDataReadmeInput,
): void {
	const { t, contents } = input;
	if (!contents) return;
	heading(t("personalDataExport.readme.fieldsTitle", "Fields"));
	lines.push(
		t(
			"personalDataExport.readme.fieldsIntro",
			"What each part of the JSON files holds and what each field means. An empty field (null) has no value.",
		),
		"",
	);
	for (const category of input.categories) {
		const entry = contents[category];
		if (!entry) continue;
		const guide = entry.guide?.(t) ?? {};
		for (const part of entry.parts) {
			const partGuide = guide[part.key];
			const csv = part.kind === "table" ? ` (${category}/${part.key}.csv)` : "";
			const label = `${category}.json > ${part.key}${csv}`;
			lines.push(partGuide?.summary ? `${label}: ${partGuide.summary}` : label);
			for (const field of part.fields) {
				const explanation = partGuide?.fields[field];
				lines.push(explanation ? `  - ${field}: ${explanation}` : `  - ${field}`);
			}
			lines.push("");
		}
	}
}

function renderAccess(
	lines: string[],
	heading: (text: string) => void,
	input: PersonalDataReadmeInput,
): void {
	const { t, access } = input;
	heading(t("personalDataExport.readme.accessTitle", "Who can access your data"));
	lines.push(
		t(
			"personalDataExport.readme.accessIntro",
			"Besides you, these people at {organization} can access your data in Z8, as of when this export was created:",
			{ organization: input.organizationName },
		),
		"",
	);
	const group = (title: string, entries: readonly string[]) => {
		lines.push(title);
		if (entries.length === 0) {
			lines.push(`  - ${t("personalDataExport.readme.accessNobody", "Nobody.")}`);
		}
		for (const entry of entries) lines.push(`  - ${entry}`);
		lines.push("");
	};

	group(
		t(
			"personalDataExport.readme.accessOwnersAdmins",
			"Owners and administrators (all of your data in the organization):",
		),
		access.ownersAndAdmins.map((person) =>
			person.role === "owner"
				? t("personalDataExport.readme.accessOwner", "{name} (owner)", {
						name: person.name,
					})
				: t("personalDataExport.readme.accessAdmin", "{name} (administrator)", {
						name: person.name,
					}),
		),
	);
	group(
		t(
			"personalDataExport.readme.accessManagers",
			"Managers (your time, absences, schedules and requests, as their role allows):",
		),
		access.managers.map((person) =>
			person.via === "direct"
				? t("personalDataExport.readme.accessManagerDirect", "{name} (your manager)", {
						name: person.name,
					})
				: t(
						"personalDataExport.readme.accessManagerTeam",
						"{name} (team permissions for your team)",
						{ name: person.name },
					),
		),
	);
	group(
		t(
			"personalDataExport.readme.accessPersonnelFileOfficers",
			"Personnel file officers (the documents in your personnel file of these categories):",
		),
		access.personnelFileOfficers.map(
			(person) =>
				`${person.name}: ${DOCUMENT_CATEGORIES.filter((category) =>
					person.categories.includes(category),
				)
					.map((category) => documentCategoryName(category, t))
					.join(", ")}`,
		),
	);
	group(
		t(
			"personalDataExport.readme.accessPayrollOfficers",
			"Payroll access (your working time and absences, exported for payroll):",
		),
		access.payrollOfficers.map((person) => {
			const covers = person.covers.map((coverage) =>
				coverage === "all"
					? t("personalDataExport.readme.accessPayrollAll", "all employees")
					: coverage === "employee"
						? t("personalDataExport.readme.accessPayrollEmployee", "you by name")
						: t("personalDataExport.readme.accessPayrollTeam", "your team"),
			);
			return `${person.name} (${covers.join(", ")})`;
		}),
	);
	group(
		t(
			"personalDataExport.readme.accessExpenseOfficers",
			"Expense officers (your approved travel expense reports and their receipts):",
		),
		access.expenseOfficers.map((person) => {
			const can = [
				t("personalDataExport.readme.accessExpenseRead", "read approved reports"),
				...(person.canExport
					? [t("personalDataExport.readme.accessExpenseExport", "export them")]
					: []),
				...(person.canRecordReimbursements
					? [t("personalDataExport.readme.accessExpenseReimburse", "record reimbursements")]
					: []),
			];
			return `${person.name}: ${can.join(", ")}`;
		}),
	);
}

function renderRetention(
	lines: string[],
	heading: (text: string) => void,
	input: PersonalDataReadmeInput,
): void {
	const { t, retention } = input;
	heading(t("personalDataExport.readme.retentionTitle", "How long your data is kept"));
	lines.push(
		t(
			"personalDataExport.readme.retentionDocuments",
			"Documents in your personnel file are kept for the period {organization} set for their category. The period counts from 1 January after the later of the year your employment ended and the year of the document. Documents of a category without a period are kept until someone deletes them.",
			{ organization: input.organizationName },
		),
	);
	for (const category of DOCUMENT_CATEGORIES) {
		const years = retention.documentYears[category];
		const name = documentCategoryName(category, t);
		lines.push(
			years === undefined
				? `  - ${t(
						"personalDataExport.readme.retentionCategoryNone",
						"{category}: no retention period set",
						{ category: name },
					)}`
				: `  - ${t(
						"personalDataExport.readme.retentionCategoryYears",
						"{category}: {years, plural, one {# year} other {# years}}",
						{ category: name, years },
					)}`,
		);
	}
	lines.push(
		"",
		t(
			"personalDataExport.readme.retentionAuditLog",
			"Audit log entries are deleted after {days} days.",
			{ days: retention.auditLogDays },
		),
		t(
			"personalDataExport.readme.retentionOther",
			"Unless stated above, your other data is kept until {organization} deletes it or your employee record is deleted.",
			{ organization: input.organizationName },
		),
		"",
	);
}

function renderRights(
	lines: string[],
	heading: (text: string) => void,
	input: PersonalDataReadmeInput,
): void {
	const { t } = input;
	const organization = input.organizationName;
	heading(t("personalDataExport.readme.rightsTitle", "Your rights"));
	lines.push(
		t(
			"personalDataExport.readme.rightsIntro",
			"Under the General Data Protection Regulation (GDPR) you have the right to:",
		),
		`  - ${t(
			"personalDataExport.readme.rightsAccess",
			"get access to your personal data and a copy of it (Art. 15 GDPR)",
		)}`,
		`  - ${t(
			"personalDataExport.readme.rightsRectification",
			"have incorrect data corrected and incomplete data completed (Art. 16 GDPR)",
		)}`,
		`  - ${t("personalDataExport.readme.rightsErasure", "have your data erased (Art. 17 GDPR)")}`,
		`  - ${t(
			"personalDataExport.readme.rightsRestriction",
			"have the processing of your data restricted (Art. 18 GDPR)",
		)}`,
		`  - ${t(
			"personalDataExport.readme.rightsNotification",
			"be told about corrections, erasures and restrictions passed on to recipients of your data (Art. 19 GDPR)",
		)}`,
		`  - ${t(
			"personalDataExport.readme.rightsPortability",
			"receive your data in a machine-readable format, such as the JSON files of this archive, and have it sent to someone else (Art. 20 GDPR)",
		)}`,
		`  - ${t(
			"personalDataExport.readme.rightsObjection",
			"object to the processing of your data (Art. 21 GDPR)",
		)}`,
		`  - ${t(
			"personalDataExport.readme.rightsComplaint",
			"complain to a data protection supervisory authority (Art. 77 GDPR)",
		)}`,
		"",
		t(
			"personalDataExport.readme.rightsContact",
			"To use these rights, contact {organization}. The privacy notice of {organization} applies and describes how it processes your data.",
			{ organization },
		),
		"",
	);
}

/** The README's plain text. */
export function renderPersonalDataExportReadme(input: PersonalDataReadmeInput): string {
	const { t } = input;
	const lines: string[] = [];
	const heading = (text: string) => lines.push(text, "=".repeat(text.length), "");

	heading(
		t("personalDataExport.readme.title", "Your personal data from {organization}", {
			organization: input.organizationName,
		}),
	);
	lines.push(
		t(
			"personalDataExport.readme.intro",
			"This archive holds the personal data {organization} keeps about {employee}, as read on {exportedAt} (UTC).",
			{
				organization: input.organizationName,
				employee: input.employeeName,
				exportedAt: input.exportedAt,
			},
		),
	);
	lines.push(
		input.kind === "employee"
			? t("personalDataExport.readme.kindEmployee", "You requested this export yourself.")
			: t(
					"personalDataExport.readme.kindAdmin",
					"An administrator of {organization} created this export on your behalf.",
					{ organization: input.organizationName },
				),
		"",
	);

	heading(t("personalDataExport.readme.filesTitle", "Files"));
	const csvCategories = input.csvCategories ? new Set(input.csvCategories) : null;
	for (const category of input.categories) {
		lines.push(`${category}.json`, `  ${categoryDescription(category, input.kind, t)}`);
		if (csvCategories && !csvCategories.has(category)) continue;
		lines.push(
			`  ${t(
				"personalDataExport.readme.csvFolder",
				"The folder {folder} holds the same tables as CSV files.",
				{ folder: `${category}/` },
			)}`,
		);
	}
	lines.push(
		"_manifest.json",
		`  ${t(
			"personalDataExport.readme.manifest",
			"Lists every file in this archive with its size and number of records.",
		)}`,
		"",
	);

	heading(t("personalDataExport.readme.formatsTitle", "Formats"));
	lines.push(
		t(
			"personalDataExport.readme.formatJson",
			"The JSON files are the complete, machine-readable copy of your data. The CSV files repeat their tables for spreadsheets.",
		),
		t(
			"personalDataExport.readme.formatTimes",
			"Points in time are written in UTC (ISO 8601, ending in Z). Time entries also carry the UTC offset in effect where they were recorded. Calendar days are written as YYYY-MM-DD.",
		),
		t(
			"personalDataExport.readme.formatOtherPeople",
			"People who acted on your records are named. People you acted on appear only as an anonymous ID.",
		),
		"",
	);

	renderFields(lines, heading, input);
	renderAccess(lines, heading, input);
	renderRetention(lines, heading, input);
	renderRights(lines, heading, input);
	if (input.kind === "employee") {
		// Always the same text: it must not say whether anything was left out, or what.
		heading(t("personalDataExport.readme.completeCopyTitle", "Complete copy"));
		lines.push(
			t(
				"personalDataExport.readme.completeCopy",
				"{organization} may keep further records about you that are not part of this export. You can ask the administrators of {organization} for a complete copy of your personal data.",
				{ organization: input.organizationName },
			),
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}
