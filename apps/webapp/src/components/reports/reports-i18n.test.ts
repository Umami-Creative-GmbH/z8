import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const reportsDir = join(import.meta.dirname);

const rawCopyPatterns = [
	/\berror:\s*error instanceof Error \? error\.message : "An unexpected error occurred"/,
	/toast\.success\("Report generated successfully"/,
	/`Generated report for \$\{result\.data\.employee\.name\}`/,
	/setError\(result\.error \|\| "Failed to generate report"\)/,
	/toast\.error\("Failed to generate report"/,
	/description:\s*result\.error \|\| "An unknown error occurred"/,
	/>Export Report</,
	/>\s*IconDownload this report in your preferred format\s*</,
	/>Generating Report\.\.\.</,
	/>\s*Please wait while we compile your data\s*</,
	/>No report generated yet</,
	/>\s*Select a period and click "Generate Report" to get started\s*</,
	/\? "Generating Report…" : "Generate Report"/,
	/toast\.error\("Export failed"/,
	/: "An error occurred while exporting the report"/,
	/toast\.success\("Export successful"/,
	/`Downloaded \$\{filename\}`/,
	/\? "Generating\.\.\." : "Export (PDF|Excel|CSV)"/,
	/aria-label="Period"/,
	/placeholder="Select period"/,
	/>Total Work Hours</,
	/>IconHome Office Days</,
	/>Vacation Days</,
	/>Total Absences</,
	/>Total Earnings</,
	/>Work Hours by Month</,
	/>Absences by Category</,
	/>IconHome Office Summary \(Tax Relevant\)/,
	/>Compliance Metrics</,
	/>Attendance Percentage</,
	/>Overtime</,
	/>Undertime</,
];

describe("reports i18n", () => {
	it("does not leave known report UI copy as raw literals", () => {
		const files = [
			"reports-container.tsx",
			"report-filters.tsx",
			"export-buttons.tsx",
			"date-range-picker.tsx",
			"report-summary-cards.tsx",
			"report-preview-table.tsx",
		];

		for (const file of files) {
			const source = readFileSync(join(reportsDir, file), "utf8");
			for (const pattern of rawCopyPatterns) {
				expect(source, `${file} should not contain raw report copy ${pattern}`).not.toMatch(
					pattern,
				);
			}
		}
	});
});
