import { describe, expect, it } from "vitest";
import { comparePayrollOutput } from "./comparison-model";
import type {
	SupportedPayrollContribution,
	SupportedPayrollOutputEvidence,
	SupportedPayrollOutputRow,
} from "./supported-output-evidence";

function contribution(
	overrides: Partial<
		Extract<SupportedPayrollContribution, { kind: "work" }>
	> = {},
): SupportedPayrollContribution {
	return {
		kind: "work",
		sourceId: "work-1",
		sourceRevision: null,
		employeeId: "employee-1",
		firstName: "Ada",
		lastName: "Lovelace",
		hours: 8,
		reason: null,
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
		...overrides,
	};
}
function row(
	overrides: Partial<SupportedPayrollOutputRow> = {},
): SupportedPayrollOutputRow {
	return {
		personnelNumber: "001",
		wageTypeCode: "1000",
		date: "2026-09-15",
		quantity: "8.00",
		unit: "hours",
		note: "Work",
		contributions: [contribution()],
		...overrides,
	};
}
function output(
	rows: SupportedPayrollOutputRow[],
): SupportedPayrollOutputEvidence {
	return {
		version: 1,
		formatId: "datev_lohn",
		formatterVersion: "2024.1",
		excludedLineKinds: ["expense"],
		rows,
	};
}

describe("payroll rendered output comparison", () => {
	it("reports the emitted quantity difference once for a row with mixed source kinds", () => {
		const absence: SupportedPayrollContribution = {
			kind: "absence",
			sourceId: "absence-1",
			sourceRevision: null,
			employeeId: "employee-1",
			firstName: "Ada",
			lastName: "Lovelace",
			hours: 4,
			reason: null,
			facts: {
				startDate: "2026-09-15",
				endDate: "2026-09-15",
				absenceCategoryId: "leave",
				absenceCategoryName: "Leave",
				absenceType: "paid",
				status: "approved",
				mappingId: "mapping-1",
			},
		};
		const result = comparePayrollOutput(
			output([
				row({
					quantity: "8.03",
					contributions: [contribution({ hours: 4.03 }), absence],
				}),
			]),
			output([
				row({
					quantity: "8.13",
					contributions: [contribution({ hours: 4.13 }), absence],
				}),
			]),
		);
		expect(result.rows).toMatchObject([
			{
				status: "changed",
				delta: "+0.10",
				employeeIds: ["employee-1"],
				changedFields: ["quantity"],
			},
		]);
		expect(result.totals).toEqual([
			{
				wageTypeCode: "1000",
				unit: "hours",
				oldQuantity: "8.03",
				newQuantity: "8.13",
				delta: "+0.10",
				hasPayrollImpact: true,
			},
		]);
		expect(result.employees[0]).toMatchObject({
			employeeId: "employee-1",
			status: "changed",
			totals: [{ delta: "+0.10" }],
		});
	});
});

it("keeps a rounded-away source edit separate from payroll impact", () => {
	const oldRow = row({
		quantity: "8.00",
		contributions: [
			contribution({ hours: 8.001, sourceRevision: "revision-1" }),
		],
	});
	const newRow = row({
		quantity: "8.00",
		contributions: [
			contribution({
				hours: 8.004,
				sourceRevision: "revision-2",
				reason: "Corrected clocking",
			}),
		],
	});
	const result = comparePayrollOutput(output([oldRow]), output([newRow]));
	expect(result.hasPayrollImpact).toBe(false);
	expect(result.rows).toEqual([]);
	expect(result.sourceOnlyChanges).toMatchObject([
		{
			outputImpact: "none",
			employeeIds: ["employee-1"],
			oldRow: { contributions: [{ sourceRevision: "revision-1" }] },
			newRow: {
				contributions: [
					{ sourceRevision: "revision-2", reason: "Corrected clocking" },
				],
			},
		},
	]);
	expect(result.employees[0]).toMatchObject({
		status: "source_only",
		totals: [{ delta: "0.00", hasPayrollImpact: false }],
	});
});

it("keeps an employee stable through personnel and wage-code moves with zero net hours", () => {
	const result = comparePayrollOutput(
		output([row()]),
		output([row({ personnelNumber: "NEW-001", wageTypeCode: "1900" })]),
	);
	expect(
		result.rows.map((entry) => ({ status: entry.status, delta: entry.delta })),
	).toEqual([
		{ status: "removed", delta: "-8.00" },
		{ status: "added", delta: "+8.00" },
	]);
	expect(result.employees).toMatchObject([
		{
			employeeId: "employee-1",
			status: "changed",
			oldPersonnelNumbers: ["001"],
			newPersonnelNumbers: ["NEW-001"],
			totals: [
				{ wageTypeCode: "1000", delta: "-8.00" },
				{ wageTypeCode: "1900", delta: "+8.00" },
			],
		},
	]);
	expect(result.hasPayrollImpact).toBe(true);
});

it("reports a note-only emitted change as payroll impact with no quantity difference", () => {
	const result = comparePayrollOutput(
		output([row()]),
		output([row({ note: "Training" })]),
	);
	expect(result.rows).toMatchObject([
		{ status: "changed", delta: "0.00", changedFields: ["note"] },
	]);
	expect(result.totals).toMatchObject([
		{ delta: "0.00", hasPayrollImpact: true },
	]);
});

it("classifies employee additions and removals without attributing by personnel number", () => {
	const result = comparePayrollOutput(
		output([row()]),
		output([
			row({
				personnelNumber: "002",
				contributions: [
					contribution({ employeeId: "employee-2", sourceId: "work-2" }),
				],
			}),
		]),
	);
	expect(
		result.employees.map((entry) => ({
			employeeId: entry.employeeId,
			status: entry.status,
		})),
	).toEqual([
		{ employeeId: "employee-1", status: "removed" },
		{ employeeId: "employee-2", status: "added" },
	]);
	expect(result.totals).toMatchObject([
		{
			oldQuantity: "8.00",
			newQuantity: "8.00",
			delta: "0.00",
			hasPayrollImpact: true,
		},
	]);
	expect(result.summary).toMatchObject({
		addedRows: 1,
		removedRows: 1,
		addedEmployees: 1,
		removedEmployees: 1,
	});
});

it("does not invent changes from source order and owns the evidence it returns", () => {
	const before = output([
		row({
			contributions: [contribution(), contribution({ sourceId: "work-2" })],
		}),
	]);
	const after = structuredClone(before);
	after.rows[0].contributions.reverse();
	expect(comparePayrollOutput(before, after)).toMatchObject({
		hasPayrollImpact: false,
		sourceOnlyChanges: [],
	});
	after.rows[0].quantity = "9.00";
	const comparison = comparePayrollOutput(before, after);
	before.rows[0].note = "Later edit";
	after.rows[0].contributions[0].sourceRevision = "later-revision";
	expect(comparison.rows[0]).toMatchObject({
		oldRow: { note: "Work" },
		newRow: {
			contributions: [{ sourceRevision: null }, { sourceRevision: null }],
		},
	});
});

it("handles empty supported output and exact decimal accumulation without floating-point drift", () => {
	expect(comparePayrollOutput(output([]), output([]))).toMatchObject({
		hasPayrollImpact: false,
		rows: [],
		employees: [],
		totals: [],
	});
	const result = comparePayrollOutput(
		output([]),
		output([
			row({ date: "2026-09-15", quantity: "0.10" }),
			row({ date: "2026-09-16", quantity: "0.20" }),
		]),
	);
	expect(result.totals).toMatchObject([
		{ newQuantity: "0.30", delta: "+0.30" },
	]);
});

it("rejects ambiguous duplicate emitted rows and non-fixed-decimal quantities", () => {
	expect(() =>
		comparePayrollOutput(output([row(), row()]), output([])),
	).toThrow("Duplicate emitted payroll row");
	expect(() =>
		comparePayrollOutput(output([row({ quantity: "1e3" })]), output([])),
	).toThrow("Invalid emitted payroll quantity");
});
