import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const REVIEWED_RETAINED_CONNECTION_FILES = [
	"src/app/[locale]/(app)/absences/page.tsx",
	"src/app/[locale]/(app)/payroll/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
	"src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
	"src/app/[locale]/(app)/settings/wellness/page.tsx",
	"src/app/[locale]/(app)/works-council/page.tsx",
	"src/app/[locale]/(auth)/layout.tsx",
	"src/app/[locale]/onboarding/layout.tsx",
] as const;

const PENDING_CONNECTION_FILES = [
	"src/app/[locale]/(admin)/platform-admin/analytics/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/billing/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/diagnostics/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/page.tsx",
	"src/app/[locale]/(admin)/platform-admin/worker-queue/page.tsx",
	"src/app/[locale]/(app)/analytics/layout.tsx",
	"src/app/[locale]/(app)/my-requests/page.tsx",
	"src/app/[locale]/(app)/page.tsx",
	"src/app/[locale]/(app)/reports/page.tsx",
	"src/app/[locale]/(app)/reports/projects/page.tsx",
	"src/app/[locale]/(app)/scheduling/page.tsx",
	"src/app/[locale]/(app)/settings/audit-export/page.tsx",
	"src/app/[locale]/(app)/settings/coverage-rules/page.tsx",
	"src/app/[locale]/(app)/settings/demo/page.tsx",
	"src/app/[locale]/(app)/settings/export-operations/page.tsx",
	"src/app/[locale]/(app)/settings/export/page.tsx",
	"src/app/[locale]/(app)/settings/import/[batchId]/page.tsx",
	"src/app/[locale]/(app)/settings/import/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-export/page.tsx",
	"src/app/[locale]/(app)/settings/scheduled-exports/page.tsx",
	"src/app/[locale]/(app)/today/page.tsx",
	"src/app/[locale]/(app)/travel-expenses/page.tsx",
	"src/app/[locale]/(auth)/verify-2fa/page.tsx",
	"src/app/[locale]/(setup)/setup/page.tsx",
] as const;

const SHELL_WORK_QUEUE = [
	{
		file: "src/app/[locale]/(app)/organization/page.tsx",
		fallbackComponent: "OrganizationPageLoading",
		contentComponent: "OrganizationPageContent",
	},
	{
		file: "src/app/[locale]/(app)/calendar/page.tsx",
		fallbackComponent: "CalendarPageLoading",
		contentComponent: "CalendarPageContent",
	},
	{
		file: "src/app/[locale]/(app)/time-tracking/page.tsx",
		fallbackComponent: "TimeTrackingPageLoading",
		contentComponent: "TimeTrackingPageContent",
	},
	{
		file: "src/app/[locale]/(app)/team/absences/page.tsx",
		fallbackComponent: "TeamAbsencesPageLoading",
		contentComponent: "TeamAbsencesPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx",
		fallbackComponent: "LocationDetailPageLoading",
		contentComponent: "LocationDetailPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/approval-policies/page.tsx",
		fallbackComponent: "ApprovalPoliciesSettingsLoading",
		contentComponent: "ApprovalPoliciesSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/permissions/page.tsx",
		fallbackComponent: "PermissionsPageLoading",
		contentComponent: "PermissionsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/work-categories/page.tsx",
		fallbackComponent: "WorkCategoriesSettingsLoading",
		contentComponent: "WorkCategoriesSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/avv/page.tsx",
		fallbackComponent: "AvvPageLoading",
		contentComponent: "AvvPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/shifts/page.tsx",
		fallbackComponent: "ShiftTemplatesPageLoading",
		contentComponent: "ShiftTemplatesPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/statistics/page.tsx",
		fallbackComponent: "StatisticsLoading",
		contentComponent: "StatisticsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/compliance/page.tsx",
		fallbackComponent: "ComplianceSettingsLoading",
		contentComponent: "ComplianceSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/implementation-checklist/page.tsx",
		fallbackComponent: "ImplementationChecklistPageLoading",
		contentComponent: "ImplementationChecklistPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/surcharges/page.tsx",
		fallbackComponent: "SurchargeSettingsPageLoading",
		contentComponent: "SurchargeSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/change-policies/page.tsx",
		fallbackComponent: "ChangePoliciesSettingsPageLoading",
		contentComponent: "ChangePoliciesSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/payroll-access/page.tsx",
		fallbackComponent: "PayrollAccessSettingsPageLoading",
		contentComponent: "PayrollAccessSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/vacation/page.tsx",
		fallbackComponent: "VacationSettingsLoading",
		contentComponent: "VacationSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/calendar/page.tsx",
		fallbackComponent: "CalendarSettingsPageLoading",
		contentComponent: "CalendarSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/work-policies/page.tsx",
		fallbackComponent: "WorkPoliciesPageLoading",
		contentComponent: "WorkPoliciesPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/roles/page.tsx",
		fallbackComponent: "CustomRolesSettingsPageLoading",
		contentComponent: "CustomRolesSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/projects/page.tsx",
		fallbackComponent: "ProjectSettingsPageLoading",
		contentComponent: "ProjectSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/holidays/page.tsx",
		fallbackComponent: "HolidaySettingsPageLoading",
		contentComponent: "HolidaySettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/compliance/works-council/page.tsx",
		fallbackComponent: "WorksCouncilSettingsPageLoading",
		contentComponent: "WorksCouncilSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/locations/page.tsx",
		fallbackComponent: "LocationSettingsPageLoading",
		contentComponent: "LocationSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/telegram/page.tsx",
		fallbackComponent: "TelegramSettingsLoading",
		contentComponent: "TelegramSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/email-templates/page.tsx",
		fallbackComponent: "EmailTemplatesSettingsPageLoading",
		contentComponent: "EmailTemplatesSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/enterprise/email/page.tsx",
		fallbackComponent: "EmailConfigLoading",
		contentComponent: "EmailConfigContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/skills/page.tsx",
		fallbackComponent: "SkillsSettingsPageLoading",
		contentComponent: "SkillsSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/billing/page.tsx",
		fallbackComponent: "BillingSettingsLoading",
		contentComponent: "BillingSettingsContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/organizations/page.tsx",
		fallbackComponent: "OrganizationsPageLoading",
		contentComponent: "OrganizationsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/travel-expenses/page.tsx",
		fallbackComponent: "TravelExpenseSettingsPageLoading",
		contentComponent: "TravelExpenseSettingsPageContent",
	},
	{
		file: "src/app/[locale]/(app)/settings/customers/page.tsx",
		fallbackComponent: "CustomerSettingsPageLoading",
		contentComponent: "CustomerSettingsPageContent",
	},
] as const;

function appPath(file: string): string {
	return join(APP_ROOT, file.replace(/^src\/app\//, ""));
}

function normalizeGlobPath(file: string): string {
	return file.replaceAll("\\", "/");
}

function maskComments(source: string): string {
	let result = "";
	let index = 0;
	let quote: '"' | "'" | "`" | undefined;

	while (index < source.length) {
		const character = source[index];
		const nextCharacter = source[index + 1];

		if (quote) {
			result += character;
			if (character === "\\") {
				index += 1;
				result += source[index] ?? "";
			} else if (character === quote) {
				quote = undefined;
			}
			index += 1;
			continue;
		}

		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			result += character;
			index += 1;
			continue;
		}

		if (character === "/" && nextCharacter === "/") {
			result += "  ";
			index += 2;
			while (index < source.length && source[index] !== "\n") {
				result += " ";
				index += 1;
			}
			continue;
		}

		if (character === "/" && nextCharacter === "*") {
			result += "  ";
			index += 2;
			while (index < source.length) {
				if (source[index] === "*" && source[index + 1] === "/") {
					result += "  ";
					index += 2;
					break;
				}
				result += source[index] === "\n" ? "\n" : " ";
				index += 1;
			}
			continue;
		}

		result += character;
		index += 1;
	}

	return result;
}

function maskStrings(source: string): string {
	let result = "";
	let index = 0;

	while (index < source.length) {
		const quote = source[index];
		if (quote !== '"' && quote !== "'" && quote !== "`") {
			result += quote;
			index += 1;
			continue;
		}

		result += " ";
		index += 1;
		while (index < source.length) {
			const character = source[index];
			result += character === "\n" ? "\n" : " ";
			index += 1;
			if (character === "\\") {
				result += source[index] === "\n" ? "\n" : " ";
				index += 1;
			} else if (character === quote) {
				break;
			}
		}
	}

	return result;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasImportedConnectionCall(source: string): boolean {
	const sourceWithoutComments = maskComments(source);
	const localIdentifiers: string[] = [];
	const namedNextServerImport =
		/\bimport\s*\{([^}]*)\}\s*from\s*(["'])next\/server\2/g;

	for (const match of sourceWithoutComments.matchAll(namedNextServerImport)) {
		for (const specifier of match[1].split(",")) {
			const connectionImport = specifier.match(
				/^\s*connection(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/,
			);
			if (connectionImport) {
				localIdentifiers.push(connectionImport[1] ?? "connection");
			}
		}
	}

	const callableSource = maskStrings(sourceWithoutComments);
	return localIdentifiers.some((identifier) =>
		new RegExp(`(?<![\\w$.])${escapeRegExp(identifier)}\\s*\\(`).test(
			callableSource,
		),
	);
}

function findJsxOpeningTagEnd(
	source: string,
	start: number,
): number | undefined {
	let braceDepth = 0;

	for (let index = start; index < source.length; index += 1) {
		if (source[index] === "{") {
			braceDepth += 1;
		} else if (source[index] === "}") {
			braceDepth -= 1;
		} else if (source[index] === ">" && braceDepth === 0) {
			return index + 1;
		}
	}

	return undefined;
}

function findMatchingSuspenseClose(
	source: string,
	openingTagEnd: number,
): number | undefined {
	const suspenseTag = /<\/?Suspense\b/g;
	suspenseTag.lastIndex = openingTagEnd;
	let depth = 1;

	for (const match of source.matchAll(suspenseTag)) {
		if (match[0].startsWith("</")) {
			depth -= 1;
			if (depth === 0) {
				return match.index;
			}
		} else {
			depth += 1;
		}
	}

	return undefined;
}

function hasFocusedSuspenseBoundary(
	source: string,
	{
		fallbackComponent,
		contentComponent,
	}: { fallbackComponent: string; contentComponent: string },
): boolean {
	const searchableSource = maskStrings(maskComments(source));
	const suspenseOpening = /<Suspense\b/g;
	const fallbackPattern = new RegExp(
		`\\bfallback\\s*=\\s*\\{\\s*<${escapeRegExp(fallbackComponent)}\\s*\\/>\\s*\\}`,
	);
	const contentPattern = new RegExp(`<${escapeRegExp(contentComponent)}\\b`);

	for (const match of searchableSource.matchAll(suspenseOpening)) {
		const openingTagEnd = findJsxOpeningTagEnd(searchableSource, match.index);
		if (!openingTagEnd) continue;

		const openingTag = searchableSource.slice(match.index, openingTagEnd);
		if (!fallbackPattern.test(openingTag)) continue;

		const closingTagStart = findMatchingSuspenseClose(
			searchableSource,
			openingTagEnd,
		);
		if (!closingTagStart) continue;

		if (
			contentPattern.test(
				searchableSource.slice(openingTagEnd, closingTagStart),
			)
		) {
			return true;
		}
	}

	return false;
}

describe("connection call source detection", () => {
	it.each([
		['import { connection } from "next/server"; await connection();', true],
		[
			'import { connection as waitForRequest } from "next/server"; await waitForRequest();',
			true,
		],
		[
			'import { connection } from "next/server"; // connection()\nreturn null;',
			false,
		],
		['import { connection } from "next/server"; database.connection();', false],
		[
			'import { connection } from "next/server"; const text = "connection()";',
			false,
		],
		['import { connection } from "next/server"; return null;', false],
		["await connection();", false],
	])("detects only an imported direct call in %#", (source, expected) => {
		expect(hasImportedConnectionCall(source)).toBe(expected);
	});

	it("normalizes platform-specific glob separators", () => {
		expect(normalizeGlobPath("[locale]\\(app)\\page.tsx")).toBe(
			"[locale]/(app)/page.tsx",
		);
	});
});

describe("focused Suspense boundary detection", () => {
	const boundary = {
		fallbackComponent: "RouteLoading",
		contentComponent: "RouteContent",
	};

	it("accepts a named fallback wrapping the expected content", () => {
		expect(
			hasFocusedSuspenseBoundary(
				"<Suspense fallback={<RouteLoading />}><RouteContent /></Suspense>",
				boundary,
			),
		).toBe(true);
	});

	it.each([
		"<Suspense fallback={<><RouteLoading /></>}><RouteContent /></Suspense>",
		"<Suspense><Other /></Suspense><div fallback={<RouteLoading />}><RouteContent /></div>",
		"<Suspense fallback={null}><RouteContent /></Suspense>",
		"<Suspense fallback={<RouteLoading />}><Other /></Suspense><RouteContent />",
	])("rejects an invalid boundary in %#", (source) => {
		expect(hasFocusedSuspenseBoundary(source, boundary)).toBe(false);
	});
});

describe("App Router connection escape hatches", () => {
	it("matches the reviewed and pending page/layout inventory exactly", () => {
		const actualFiles = globSync("**/{page,layout}.tsx", { cwd: APP_ROOT })
			.filter((file) =>
				hasImportedConnectionCall(readFileSync(join(APP_ROOT, file), "utf8")),
			)
			.map((file) => `src/app/${normalizeGlobPath(file)}`)
			.sort();
		const retainedFiles = [...REVIEWED_RETAINED_CONNECTION_FILES].sort();
		const pendingFiles = [...PENDING_CONNECTION_FILES].sort();
		const overlap = retainedFiles.filter((file) => pendingFiles.includes(file));

		expect(overlap).toEqual([]);
		expect([...retainedFiles, ...pendingFiles].sort()).toEqual(actualFiles);
	});

	it("lists only files that exist", () => {
		for (const file of [
			...REVIEWED_RETAINED_CONNECTION_FILES,
			...PENDING_CONNECTION_FILES,
		]) {
			expect(existsSync(appPath(file)), file).toBe(true);
		}
	});
});

describe("low-risk route streaming boundaries", () => {
	it("registers every shell work queue route exactly once", () => {
		const workQueueFiles = SHELL_WORK_QUEUE.map(({ file }) => file);

		expect(workQueueFiles).toHaveLength(32);
		expect(new Set(workQueueFiles).size).toBe(workQueueFiles.length);
	});

	it.each(SHELL_WORK_QUEUE)(
		"keeps a focused Suspense fallback in $file",
		(route) => {
			const { file } = route;
			const source = readFileSync(appPath(file), "utf8");

			expect(hasFocusedSuspenseBoundary(source, route), file).toBe(true);
		},
	);
});
