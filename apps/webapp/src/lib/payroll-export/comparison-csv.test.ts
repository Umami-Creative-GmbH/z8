import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { payrollComparisonCsv } from "./comparison-csv";
import { comparePayrollOutput } from "./comparison-model";
import type { ReviewedPayrollComparison } from "./comparison-types";
import type { SupportedPayrollOutputEvidence } from "./supported-output-evidence";

function reviewed(): ReviewedPayrollComparison {
	const before: SupportedPayrollOutputEvidence = {
		version: 1,
		formatId: "datev_lohn",
		formatterVersion: "2024.1",
		excludedLineKinds: ["expense"],
		rows: [
			{
				personnelNumber: " \t=SECRET()",
				date: "2026-09-15",
				wageTypeCode: "1000",
				unit: "hours",
				quantity: "8.00",
				note: 'Old, "note"\nsecond line',
				contributions: [
					{
						kind: "work",
						sourceId: "work-1",
						sourceRevision: "revision-1",
						sourceActorId: "actor-1",
						employeeId: "employee-1",
						firstName: "Ada",
						lastName: "Lovelace",
						hours: 8,
						reason: "Corrected clocking",
						facts: {
							startAt: null,
							endAt: null,
							durationMinutes: 480,
							workCategoryId: null,
							workCategoryName: null,
							projectId: null,
							projectName: null,
							mappingId: null,
						},
					},
				],
			},
		],
	};
	const after = structuredClone(before);
	after.rows[0].quantity = "7.50";
	after.rows[0].note = "\u0001 \t+SUM(1,1)";
	return {
		id: "comparison-1",
		baseline: {
			id: "baseline-1",
			jobId: "job-1",
			formatId: "datev_lohn",
			destination: {
				configId: "destination-1",
				mandantennummer: "01234",
				beraternummer: "1234567",
			},
			period: { startDate: "2026-09-01", endDate: "2026-09-30" },
			employeeIds: ["employee-1"],
			createdAt: "2026-10-01T08:00:00Z",
			completedAt: "2026-10-01T08:01:00Z",
			expiresAt: "2027-01-01T00:00:00Z",
			availability: "available",
		},
		preparedAt: "2026-10-18T08:00:00Z",
		expiresAt: "2026-10-19T08:00:00Z",
		filters: {
			dateRange: { start: "2026-09-01", end: "2026-09-30" },
			projectIds: ["project-1"],
		},
		comparison: comparePayrollOutput(before, after),
	};
}

describe("reviewed payroll comparison CSV", () => {
	it("exports reviewed metadata, escaped evidence and safe text while retaining signed decimal cells", () => {
		const report = reviewed();
		const csv = payrollComparisonCsv(report);
		const parsed = Papa.parse<Record<string, string>>(csv, {
			header: true,
			skipEmptyLines: true,
		});
		expect(parsed.errors).toEqual([]);
		const metadata = Object.fromEntries(
			parsed.data
				.filter((entry) => entry.record_type === "metadata")
				.map((entry) => [entry.field, entry.value]),
		);
		expect(metadata).toMatchObject({
			scope_notice:
				"Expense reimbursements are excluded. No change applies only to supported payroll lines.",
			comparison_id: "comparison-1",
			baseline_id: "baseline-1",
			baseline_job_id: "job-1",
			destination_config_id: "destination-1",
			mandantennummer: "01234",
			beraternummer: "1234567",
			period_start: "2026-09-01",
			period_end: "2026-09-30",
			employee_scope: '["employee-1"]',
			filters:
				'{"dateRange":{"start":"2026-09-01","end":"2026-09-30"},"projectIds":["project-1"]}',
			prepared_at: "2026-10-18T08:00:00Z",
			excluded_line_kinds: '["expense"]',
		});
		const change = parsed.data.find((entry) => entry.record_type === "row");
		expect(change).toMatchObject({
			status: "changed",
			old_personnel_number: "' \t=SECRET()",
			new_personnel_number: "' \t=SECRET()",
			old_quantity: "8.00",
			new_quantity: "7.50",
			signed_delta: "-0.50",
			old_note: 'Old, "note"\nsecond line',
			new_note: "'\u0001 \t+SUM(1,1)",
		});
		expect(change?.old_sources).toContain('"sourceRevision":"revision-1"');
		expect(csv).toContain(",8.00,7.50,-0.50,");
		expect(payrollComparisonCsv(report)).toBe(csv);
	});
});

it("retains reliable deletion explanations in the reviewed report", () => {
	const report = reviewed();
	report.explanations = [
		{
			kind: "work",
			sourceId: "deleted-work",
			employeeId: "employee-1",
			action: "delete",
			actorId: "operator-1",
			reason: "Duplicate clocking",
		},
	];
	const parsed = Papa.parse<Record<string, string>>(
		payrollComparisonCsv(report),
		{ header: true, skipEmptyLines: true },
	);
	expect(
		parsed.data.find((entry) => entry.record_type === "explanation"),
	).toMatchObject({
		employee_ids: '["employee-1"]',
		field: "work",
		value:
			'{"kind":"work","sourceId":"deleted-work","employeeId":"employee-1","action":"delete","actorId":"operator-1","reason":"Duplicate clocking"}',
	});
});
