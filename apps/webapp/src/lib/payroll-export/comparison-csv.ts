import type { ReviewedPayrollComparison } from "./comparison-types";
import type { SupportedPayrollOutputRow } from "./supported-output-evidence";

type NumericCell = { decimal: string };
type Cell = string | NumericCell;
const columns = [
	"record_type",
	"field",
	"value",
	"status",
	"employee_ids",
	"old_personnel_number",
	"new_personnel_number",
	"date",
	"wage_type_code",
	"unit",
	"old_quantity",
	"new_quantity",
	"signed_delta",
	"old_note",
	"new_note",
	"old_sources",
	"new_sources",
	"changed_fields",
	"old_rendered_columns",
	"new_rendered_columns",
] as const;
type Column = (typeof columns)[number];

function numeric(decimal: string): NumericCell {
	if (!/^[+-]?\d+\.\d{2}$/.test(decimal))
		throw new Error("Invalid comparison report quantity");
	return { decimal };
}
function cell(value: Cell): string {
	if (typeof value !== "string") return value.decimal;
	// Quoting alone does not prevent spreadsheet formulas. Keep controls visible in
	// evidence, but insert a text marker before every whitespace/control-prefixed trigger.
	let start = 0;
	while (start < value.length) {
		const code = value.charCodeAt(start);
		if (code > 0x20 && code !== 0x7f && !/\s/.test(value[start])) break;
		start++;
	}
	const safe =
		/^[=+@-]/.test(value.slice(start)) ||
		[9, 10, 13].includes(value.charCodeAt(0))
			? `'${value}`
			: value;
	return `"${safe.replaceAll('"', '""')}"`;
}

/** Serializes only the immutable reviewed result; does not query or recompute payroll. */
export function payrollComparisonCsv(
	result: ReviewedPayrollComparison,
): string {
	const records: Partial<Record<Column, Cell>>[] = [];
	const { baseline, comparison } = result;
	const metadata: Record<string, string> = {
		report_type: "Payroll comparison report",
		scope_notice:
			"Expense reimbursements are excluded. No change applies only to supported payroll lines.",
		comparison_id: result.id,
		baseline_id: baseline.id,
		baseline_job_id: baseline.jobId,
		format: baseline.formatId,
		baseline_created_at: baseline.createdAt,
		baseline_completed_at: baseline.completedAt,
		baseline_expires_at: baseline.expiresAt,
		destination_config_id: baseline.destination.configId,
		mandantennummer: baseline.destination.mandantennummer,
		beraternummer: baseline.destination.beraternummer,
		period_start: baseline.period.startDate,
		period_end: baseline.period.endDate,
		employee_scope: JSON.stringify(baseline.employeeIds),
		filters: JSON.stringify(result.filters),
		prepared_at: result.preparedAt,
		expires_at: result.expiresAt,
		old_formatter_version: comparison.formatterVersions.old,
		new_formatter_version: comparison.formatterVersions.new,
		excluded_line_kinds: JSON.stringify(comparison.excludedLineKinds),
		has_payroll_impact: String(comparison.hasPayrollImpact),
		summary: JSON.stringify(comparison.summary),
	};
	for (const [field, value] of Object.entries(metadata))
		records.push({ record_type: "metadata", field, value });
	function addRow(
		type: string,
		status: string,
		employeeIds: string[],
		oldRow: SupportedPayrollOutputRow | null,
		newRow: SupportedPayrollOutputRow | null,
		delta: string,
		changedFields: string[],
	) {
		const row = newRow ?? oldRow;
		if (!row) return;
		records.push({
			record_type: type,
			status,
			employee_ids: JSON.stringify(employeeIds),
			old_personnel_number: oldRow?.personnelNumber ?? "",
			new_personnel_number: newRow?.personnelNumber ?? "",
			date: row.date,
			wage_type_code: row.wageTypeCode,
			unit: row.unit,
			old_quantity: numeric(oldRow?.quantity ?? "0.00"),
			new_quantity: numeric(newRow?.quantity ?? "0.00"),
			signed_delta: numeric(delta),
			old_note: oldRow?.note ?? "",
			new_note: newRow?.note ?? "",
			old_sources: JSON.stringify(oldRow?.contributions ?? []),
			new_sources: JSON.stringify(newRow?.contributions ?? []),
			changed_fields: JSON.stringify(changedFields),
			old_rendered_columns: JSON.stringify(oldRow?.renderedColumns ?? {}),
			new_rendered_columns: JSON.stringify(newRow?.renderedColumns ?? {}),
		});
	}
	for (const change of comparison.rows)
		addRow(
			"row",
			change.status,
			change.employeeIds,
			change.oldRow,
			change.newRow,
			change.delta,
			change.changedFields,
		);
	for (const change of comparison.sourceOnlyChanges)
		addRow(
			"source_only",
			"source_only",
			change.employeeIds,
			change.oldRow,
			change.newRow,
			"0.00",
			["contributions"],
		);
	for (const explanation of result.explanations ?? [])
		records.push({
			record_type: "explanation",
			employee_ids: JSON.stringify([explanation.employeeId]),
			field: explanation.kind,
			value: JSON.stringify(explanation),
		});
	for (const employee of comparison.employees) {
		records.push({
			record_type: "employee",
			status: employee.status,
			employee_ids: JSON.stringify([employee.employeeId]),
			old_personnel_number: JSON.stringify(employee.oldPersonnelNumbers),
			new_personnel_number: JSON.stringify(employee.newPersonnelNumbers),
			field: "name",
			value: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
		});
		for (const total of employee.totals)
			records.push({
				record_type: "employee_total",
				status: total.hasPayrollImpact ? "changed" : "unchanged",
				employee_ids: JSON.stringify([employee.employeeId]),
				wage_type_code: total.wageTypeCode,
				unit: total.unit,
				old_quantity: numeric(total.oldQuantity),
				new_quantity: numeric(total.newQuantity),
				signed_delta: numeric(total.delta),
			});
	}
	for (const total of comparison.totals)
		records.push({
			record_type: "total",
			status: total.hasPayrollImpact ? "changed" : "unchanged",
			wage_type_code: total.wageTypeCode,
			unit: total.unit,
			old_quantity: numeric(total.oldQuantity),
			new_quantity: numeric(total.newQuantity),
			signed_delta: numeric(total.delta),
		});
	return `\uFEFF${[columns.map(cell).join(","), ...records.map((record) => columns.map((column) => cell(record[column] ?? "")).join(","))].join("\r\n")}\r\n`;
}
