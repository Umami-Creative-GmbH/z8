/**
 * The README of a personal data export (#811), in the employee's UI language
 * (else the organization's default), also when an admin started the export.
 * Keys live in the `common` namespace under `personalDataExport.readme.*`.
 *
 * This is the skeleton: what the archive is, its files and formats. The
 * Art. 15 sections (who can access the data, how long it is kept, the
 * employee's rights) are added as further sections.
 */

import { loadNamespaces, TolgeeBase } from "@/tolgee/shared";
import type { PersonalDataCategoryKey, PersonalDataExportKind } from "./collector";

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
	} catch {
		return fallbackReadmeTranslator;
	}
}

/** English defaults with `{param}` placeholders filled in. */
export const fallbackReadmeTranslator: ReadmeTranslate = (_key, defaultValue, params) =>
	defaultValue.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);

/** One static `t()` per category, so the extractor reads every default. */
function categoryDescription(category: PersonalDataCategoryKey, t: ReadmeTranslate): string {
	switch (category) {
		case "employment":
			return t(
				"personalDataExport.readme.category.employment",
				"Your employee record and profile, employment periods and departure, employment terms with your hourly wage and its history, teams, managers, locations, skills, project assignments, roles, groups, cost centre and every policy assigned to you.",
			);
		case "time":
			return t(
				"personalDataExport.readme.category.time",
				"Your time entries, work periods and corrections, breaks, automatic clock-outs, compliance exceptions, surcharges, balances and balance adjustments.",
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
	for (const category of input.categories) {
		lines.push(`${category}.json`, `  ${categoryDescription(category, t)}`);
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
	return `${lines.join("\n")}\n`;
}
