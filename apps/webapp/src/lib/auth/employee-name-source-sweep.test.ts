import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(process.cwd(), "src");

const allowedPathFragments = [
	"src/db/schema/",
	"src/db/auth-schema.ts",
	"src/lib/auth/derived-user-name.ts",
	".test.",
];

const forbiddenPatterns = [
	/\b\w*employee\.firstName\b/,
	/\b\w*employee\.lastName\b/,
	/firstName:\s*validatedData\.firstName/,
	/lastName:\s*validatedData\.lastName/,
];

const targetedForbiddenPatterns: Record<string, RegExp[]> = {
	"src/lib/export/data-fetchers.ts": [
		/\bemp\.firstName\b/,
		/\bemp\.lastName\b/,
	],
	"src/app/[locale]/(app)/settings/compliance/actions.ts": [
		/\bemp\.firstName\b/,
		/\bemp\.lastName\b/,
	],
	"src/lib/jobs/export-processor.ts": [
		/\bemp\.firstName\b/,
		/\bemp\.lastName\b/,
	],
	"src/lib/payroll-export/data-fetcher.ts": [
		/p\.employee\?\.firstName/,
		/p\.employee\?\.lastName/,
		/a\.employee\?\.firstName/,
		/a\.employee\?\.lastName/,
		/employee:\s*\{\s*columns:\s*\{[^}]*firstName:\s*true,[^}]*lastName:\s*true/s,
		/getEmployeesForFilter[\s\S]*columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
		/getEmployeesForFilter[\s\S]*orderBy:\s*\([^)]*\)\s*=>\s*\[asc\([^)]*\.lastName\),\s*asc\([^)]*\.firstName\)\]/,
	],
	"src/app/[locale]/(app)/settings/locations/actions.ts": [
		/\be\.firstName\b/,
		/\be\.lastName\b/,
	],
	"src/components/settings/work-policy/work-policy-compliance-view.tsx": [
		/\bemployeeRecord\.firstName\b/,
		/\bemployeeRecord\.lastName\b/,
	],
	"src/app/[locale]/(app)/settings/change-policies/actions.ts": [
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
	],
	"src/app/[locale]/(app)/settings/surcharges/actions.ts": [
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
	],
	"src/app/[locale]/(app)/settings/work-policies/actions.ts": [
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true,\s*employeeNumber:\s*true/s,
		/orderBy:\s*\([^)]*\)\s*=>\s*\[asc\([^)]*\.lastName\),\s*asc\([^)]*\.firstName\)\]/,
	],
	"src/app/[locale]/(app)/settings/holidays/actions.ts": [
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
	],
	"src/app/[locale]/(app)/settings/calendar/actions.ts": [
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true/s,
	],
	"src/app/[locale]/(app)/settings/scheduled-exports/actions.ts": [
		/\be\.firstName\b/,
		/\be\.lastName\b/,
		/columns:\s*\{\s*id:\s*true,\s*firstName:\s*true,\s*lastName:\s*true,\s*employeeNumber:\s*true/s,
		/orderBy:\s*\([^)]*\)\s*=>\s*\[asc\([^)]*\.lastName\),\s*asc\([^)]*\.firstName\)\]/,
	],
};

function collectSourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		const stat = statSync(path);

		if (stat.isDirectory()) {
			return collectSourceFiles(path);
		}

		return /\.(ts|tsx)$/.test(entry) ? [path] : [];
	});
}

describe("employee name source sweep", () => {
	it("keeps product display/search/write code off deprecated employee name columns", () => {
		const offenders = collectSourceFiles(srcRoot).flatMap((filePath) => {
			const relativePath = relative(process.cwd(), filePath);

			if (
				allowedPathFragments.some((fragment) => relativePath.includes(fragment))
			) {
				return [];
			}

			const source = readFileSync(filePath, "utf8");
			const patterns = [
				...forbiddenPatterns,
				...(targetedForbiddenPatterns[relativePath] ?? []),
			];

			return patterns
				.filter((pattern) => pattern.test(source))
				.map((pattern) => `${relativePath}: ${pattern}`);
		});

		expect(offenders).toEqual([]);
	});
});
