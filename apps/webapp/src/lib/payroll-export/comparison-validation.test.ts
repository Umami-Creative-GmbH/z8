import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { comparePayrollOutput } from "./comparison-model";
import type { ReviewedPayrollComparison } from "./comparison-types";
import { isReviewedPayrollComparison } from "./comparison-validation";
import type { SupportedPayrollOutputEvidence } from "./supported-output-evidence";

function reviewed(): ReviewedPayrollComparison {
	const oldOutput: SupportedPayrollOutputEvidence = {
		version: 1,
		formatId: "datev_lohn",
		formatterVersion: "2024.1",
		excludedLineKinds: ["expense"],
		rows: [
			{
				personnelNumber: "001",
				date: "2026-09-15",
				wageTypeCode: "1000",
				unit: "hours",
				quantity: "8.00",
				note: "Work",
				contributions: [
					{
						kind: "work",
						sourceId: "work-1",
						sourceRevision: null,
						employeeId: "employee-1",
						firstName: "Ada",
						lastName: "Lovelace",
						hours: 8,
						reason: null,
						facts: {
							startAt: "2026-09-15T08:00:00Z",
							endAt: "2026-09-15T16:00:00Z",
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
	const current = structuredClone(oldOutput);
	current.rows[0].quantity = "9.00";
	return {
		id: "comparison-1",
		baseline: {
			id: "baseline-1",
			jobId: "job-1",
			formatId: "datev_lohn",
			destination: {
				configId: "config-1",
				mandantennummer: "12345",
				beraternummer: "1234567",
			},
			period: { startDate: "2026-09-01", endDate: "2026-09-30" },
			employeeIds: ["employee-1"],
			createdAt: "2026-10-01T08:00:00Z",
			completedAt: "2026-10-01T08:01:00Z",
			expiresAt: "2028-10-01T08:01:00Z",
			availability: "available",
		},
		filters: {
			dateRange: { start: "2026-09-01", end: "2026-09-30" },
			employeeIds: ["employee-1"],
		},
		preparedAt: "2026-10-18T08:00:00Z",
		expiresAt: "2026-10-19T08:00:00Z",
		comparison: comparePayrollOutput(oldOutput, current),
	};
}

it("accepts a complete reviewed result and rejects absent retained payloads safely", () => {
	expect(isReviewedPayrollComparison(reviewed())).toBe(true);
	for (const value of [
		null,
		undefined,
		{},
		"{}",
		{ baseline: null },
		{ comparison: { version: 2 } },
	])
		expect(isReviewedPayrollComparison(value)).toBe(false);
});

it("rejects corrupt nested values and unsupported comparison versions before consumers access them", () => {
	const invalid = [];
	const version = reviewed();
	Reflect.set(version.comparison, "version", 2);
	invalid.push(version);
	const totals = reviewed();
	Reflect.set(totals.comparison, "totals", null);
	invalid.push(totals);
	const delta = reviewed();
	Reflect.set(delta.comparison.rows[0], "delta", "+1e3");
	invalid.push(delta);
	const negativeCount = reviewed();
	negativeCount.comparison.summary.changedRows = -1;
	invalid.push(negativeCount);
	const wrongCount = reviewed();
	wrongCount.comparison.summary.changedRows = 7;
	invalid.push(wrongCount);
	const invalidDay = reviewed();
	invalidDay.baseline.period.endDate = "2026-02-30";
	invalid.push(invalidDay);
	const invalidInstant = reviewed();
	invalidInstant.preparedAt = "2026-10-18T08:00:00";
	invalid.push(invalidInstant);
	const filter = reviewed();
	Reflect.set(filter.filters, "employeeIds", [123]);
	invalid.push(filter);
	const missingSource = reviewed();
	Reflect.set(missingSource.comparison.rows[0].oldRow ?? {}, "contributions", [
		{},
	]);
	invalid.push(missingSource);
	const invalidSource = reviewed();
	Reflect.set(
		invalidSource.comparison.rows[0].newRow?.contributions[0] ?? {},
		"reason",
		["not text"],
	);
	invalid.push(invalidSource);
	const unsupportedSource = reviewed();
	Reflect.set(
		unsupportedSource.comparison.rows[0].newRow?.contributions[0] ?? {},
		"kind",
		"expense",
	);
	invalid.push(unsupportedSource);
	const nonfiniteSource = reviewed();
	Reflect.set(
		nonfiniteSource.comparison.rows[0].oldRow?.contributions[0] ?? {},
		"hours",
		Number.POSITIVE_INFINITY,
	);
	invalid.push(nonfiniteSource);
	const malformedFact = reviewed();
	Reflect.set(
		malformedFact.comparison.rows[0].oldRow?.contributions[0].facts ?? {},
		"startAt",
		"yesterday",
	);
	invalid.push(malformedFact);
	const wrongScope = reviewed();
	Reflect.set(
		wrongScope.comparison.rows[0].newRow?.contributions[0] ?? {},
		"employeeId",
		"foreign-employee",
	);
	invalid.push(wrongScope);
	const rowPresence = reviewed();
	rowPresence.comparison.rows[0].oldRow = null;
	invalid.push(rowPresence);
	const differentFormat = reviewed();
	differentFormat.comparison.formatId = "sage_lohn";
	invalid.push(differentFormat);
	for (const value of invalid)
		expect(isReviewedPayrollComparison(value)).toBe(false);
});

it("validates optional explanations and source-only rows as deeply as output changes", () => {
	const value = reviewed();
	const row = value.comparison.rows[0];
	if (!row.oldRow || !row.newRow)
		throw new Error("Expected two-sided evidence");
	value.comparison.sourceOnlyChanges = [
		{
			key: "source-only",
			employeeIds: ["employee-1"],
			oldRow: row.oldRow,
			newRow: row.newRow,
			outputImpact: "none",
		},
	];
	value.explanations = [
		{
			kind: "work",
			sourceId: "work-1",
			employeeId: "employee-1",
			action: "deleted",
			actorId: null,
			reason: null,
		},
	];
	expect(isReviewedPayrollComparison(value)).toBe(true);
	Reflect.set(value.explanations[0], "actorId", { id: "user" });
	expect(isReviewedPayrollComparison(value)).toBe(false);
	value.explanations = undefined;
	Reflect.set(
		value.comparison.sourceOnlyChanges[0].oldRow.contributions[0],
		"facts",
		null,
	);
	expect(isReviewedPayrollComparison(value)).toBe(false);
});

it("accepts format-specific row periods for each supported format", () => {
	for (const formatId of ["lexware_lohn", "sage_lohn"]) {
		const value = reviewed();
		Reflect.set(value.baseline, "formatId", formatId);
		Reflect.set(value.comparison, "formatId", formatId);
		if (formatId === "lexware_lohn")
			for (const change of [
				...value.comparison.rows,
				...value.comparison.sourceOnlyChanges,
			])
				for (const row of [change.oldRow, change.newRow])
					if (row) row.date = "2026-09";
		expect(isReviewedPayrollComparison(value)).toBe(true);
	}
});

it("rejects malformed retained JSON even when its stored digest matches its bytes", () => {
	const record = {
		result: { baseline: null },
		digest: "97481263a2b880286d219b9e7f4c6a68ae2f9b9ec14504afa29da7b13207b54a",
	};
	expect(
		createHash("sha256").update(JSON.stringify(record.result)).digest("hex"),
	).toBe(record.digest);
	expect(isReviewedPayrollComparison(record.result)).toBe(false);
});
