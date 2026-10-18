import type {
	PayrollCodeTotal,
	PayrollEmployeeChange,
	PayrollOutputComparison,
	PayrollRowChange,
	PayrollSourceOnlyChange,
} from "./comparison-types";
import type {
	SupportedPayrollOutputEvidence,
	SupportedPayrollOutputRow,
} from "./supported-output-evidence";

function renderedSignature(row: SupportedPayrollOutputRow): string {
	return JSON.stringify(
		Object.entries(row.renderedColumns ?? {}).sort(([a], [b]) =>
			a.localeCompare(b),
		),
	);
}
function rowKey(row: SupportedPayrollOutputRow): string {
	return JSON.stringify([
		row.personnelNumber,
		row.date,
		row.wageTypeCode,
		row.unit,
	]);
}
function cents(value: string): bigint {
	if (!/^-?\d+\.\d{2}$/.test(value))
		throw new Error("Invalid emitted payroll quantity");
	return BigInt(value.replace(".", ""));
}
function decimal(value: bigint, signed = false): string {
	const absolute = value < BigInt(0) ? -value : value;
	return `${value < BigInt(0) ? "-" : signed && value > BigInt(0) ? "+" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
function employeeIds(rows: SupportedPayrollOutputRow[]): string[] {
	return [
		...new Set(
			rows.flatMap((row) => row.contributions.map((entry) => entry.employeeId)),
		),
	].sort();
}
function contributionSignature(row: SupportedPayrollOutputRow): string {
	return JSON.stringify(
		row.contributions
			.map((entry) =>
				JSON.stringify(entry, (_key, value) =>
					value && typeof value === "object" && !Array.isArray(value)
						? Object.fromEntries(
								Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
							)
						: value,
				),
			)
			.sort(),
	);
}
function indexRows(
	rows: SupportedPayrollOutputRow[],
): Map<string, SupportedPayrollOutputRow> {
	const result = new Map<string, SupportedPayrollOutputRow>();
	for (const row of rows) {
		cents(row.quantity);
		const key = rowKey(row);
		if (result.has(key)) throw new Error("Duplicate emitted payroll row");
		result.set(key, row);
	}
	return result;
}
function totals(
	oldRows: SupportedPayrollOutputRow[],
	newRows: SupportedPayrollOutputRow[],
	changes: PayrollRowChange[],
): PayrollCodeTotal[] {
	const byCode = new Map<
		string,
		{
			wageTypeCode: string;
			unit: string;
			old: bigint;
			new: bigint;
			impact: boolean;
		}
	>();
	for (const [side, rows] of [
		["old", oldRows],
		["new", newRows],
	] as const) {
		for (const row of rows) {
			const key = JSON.stringify([row.wageTypeCode, row.unit]);
			const total = byCode.get(key) ?? {
				wageTypeCode: row.wageTypeCode,
				unit: row.unit,
				old: BigInt(0),
				new: BigInt(0),
				impact: false,
			};
			total[side] += cents(row.quantity);
			byCode.set(key, total);
		}
	}
	for (const change of changes) {
		for (const row of [change.oldRow, change.newRow]) {
			if (row) {
				const total = byCode.get(JSON.stringify([row.wageTypeCode, row.unit]));
				if (total) total.impact = true;
			}
		}
	}
	return [...byCode.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, total]) => ({
			wageTypeCode: total.wageTypeCode,
			unit: total.unit,
			oldQuantity: decimal(total.old),
			newQuantity: decimal(total.new),
			delta: decimal(total.new - total.old, true),
			hasPayrollImpact: total.impact,
		}));
}

/** Compares target rows at their emitted grouping and precision, never raw contribution sums. */
export function comparePayrollOutput(
	oldOutput: SupportedPayrollOutputEvidence,
	newOutput: SupportedPayrollOutputEvidence,
): PayrollOutputComparison {
	if (
		oldOutput.version !== 1 ||
		newOutput.version !== 1 ||
		oldOutput.formatId !== newOutput.formatId
	)
		throw new Error("Incompatible payroll output evidence");
	// Own both sides so later caller edits cannot change the reviewed evidence.
	const oldRows = structuredClone(oldOutput.rows);
	const newRows = structuredClone(newOutput.rows);
	const oldIndex = indexRows(oldRows);
	const newIndex = indexRows(newRows);
	const changes: PayrollRowChange[] = [];
	const sourceOnlyChanges: PayrollSourceOnlyChange[] = [];
	for (const key of [
		...new Set([...oldIndex.keys(), ...newIndex.keys()]),
	].sort()) {
		const oldRow = oldIndex.get(key) ?? null;
		const newRow = newIndex.get(key) ?? null;
		const changedFields =
			oldRow && newRow
				? ["quantity", "note", "renderedColumns"].filter((field) =>
						field === "quantity"
							? oldRow.quantity !== newRow.quantity
							: field === "note"
								? oldRow.note !== newRow.note
								: renderedSignature(oldRow) !== renderedSignature(newRow),
					)
				: ["row"];
		if (!changedFields.length) {
			if (
				oldRow &&
				newRow &&
				contributionSignature(oldRow) !== contributionSignature(newRow)
			)
				sourceOnlyChanges.push({
					key,
					employeeIds: employeeIds([oldRow, newRow]),
					oldRow,
					newRow,
					outputImpact: "none",
				});
			continue;
		}
		changes.push({
			key,
			status: !oldRow ? "added" : !newRow ? "removed" : "changed",
			employeeIds: employeeIds([
				...(oldRow ? [oldRow] : []),
				...(newRow ? [newRow] : []),
			]),
			oldRow,
			newRow,
			delta: decimal(
				cents(newRow?.quantity ?? "0.00") - cents(oldRow?.quantity ?? "0.00"),
				true,
			),
			changedFields,
		});
	}
	const employees: PayrollEmployeeChange[] = employeeIds([
		...oldRows,
		...newRows,
	]).map((employeeId) => {
		const before = oldRows.filter((row) =>
			row.contributions.some((entry) => entry.employeeId === employeeId),
		);
		const after = newRows.filter((row) =>
			row.contributions.some((entry) => entry.employeeId === employeeId),
		);
		const affected = changes.filter((change) =>
			change.employeeIds.includes(employeeId),
		);
		const sourceChanges = sourceOnlyChanges.filter((change) =>
			change.employeeIds.includes(employeeId),
		);
		const identity = [...after, ...before]
			.flatMap((row) => row.contributions)
			.find((entry) => entry.employeeId === employeeId);
		return {
			employeeId,
			firstName: identity?.firstName ?? null,
			lastName: identity?.lastName ?? null,
			status: !before.length
				? "added"
				: !after.length
					? "removed"
					: affected.length
						? "changed"
						: sourceChanges.length
							? "source_only"
							: "unchanged",
			oldPersonnelNumbers: [
				...new Set(before.map((row) => row.personnelNumber)),
			].sort(),
			newPersonnelNumbers: [
				...new Set(after.map((row) => row.personnelNumber)),
			].sort(),
			rowKeys: [...affected, ...sourceChanges].map((row) => row.key),
			totals: totals(before, after, affected),
		};
	});
	return {
		version: 1,
		formatId: newOutput.formatId,
		formatterVersions: {
			old: oldOutput.formatterVersion,
			new: newOutput.formatterVersion,
		},
		excludedLineKinds: [
			...new Set([
				...oldOutput.excludedLineKinds,
				...newOutput.excludedLineKinds,
			]),
		].sort(),
		hasPayrollImpact: changes.length > 0,
		rows: changes,
		employees,
		totals: totals(oldRows, newRows, changes),
		sourceOnlyChanges,
		summary: {
			addedRows: changes.filter((row) => row.status === "added").length,
			removedRows: changes.filter((row) => row.status === "removed").length,
			changedRows: changes.filter((row) => row.status === "changed").length,
			addedEmployees: employees.filter((entry) => entry.status === "added")
				.length,
			removedEmployees: employees.filter((entry) => entry.status === "removed")
				.length,
			changedEmployees: employees.filter((entry) => entry.status === "changed")
				.length,
			sourceOnlyEmployees: employees.filter(
				(entry) => entry.status === "source_only",
			).length,
		},
	};
}
