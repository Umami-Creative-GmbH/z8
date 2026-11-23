import { csvFile, csvText } from "@/lib/export/csv-cells";
import {
	basisLabel,
	dayUnitRuleLabel,
	type StatementTranslate,
	statementLabels,
	unitLabel,
} from "./labels";
import type { ContractorStatement } from "./statement";

/**
 * The Contractor Time & Fee Statement as CSV (#2000): a labelled header block
 * (title, the "not an invoice" notice, organization, contractor, contracting
 * details, period), then one table. Its `Day` rows carry the day's terms,
 * units and amount; its `Work` rows each work period's share of that day by
 * project and task, with its part of the amount; `Total` rows per currency
 * and an `Unpriced` row close it. Summing `Work` (or `Day`) amounts gives the
 * total. Dates are ISO; times are local at the offset the work recorded,
 * with that offset. Text cells are formula-safe (`@/lib/export/csv-cells`).
 * Pure and client-safe.
 */

const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A number written unquoted; anything else as text. */
function cell(value: string | number | null | undefined): string {
	if (typeof value === "number") return String(value);
	if (value && NUMBER.test(value)) return value;
	return csvText(value ?? "");
}

export function contractorStatementCsv(
	statement: ContractorStatement,
	options: { t: StatementTranslate },
): string {
	const { t } = options;
	const labels = statementLabels(t);
	const text = (values: readonly (string | null)[]) => values.map((value) => csvText(value ?? ""));
	const { contractor } = statement;

	const preamble = [
		text([labels.title]),
		text([labels.notice]),
		text([labels.organization, statement.organizationName]),
		text([labels.contractor, contractor.name]),
		text([labels.contractorNumber, contractor.employeeNumber]),
		text([labels.company, contractor.companyName]),
		text([labels.vatId, contractor.vatId]),
		text([labels.referenceCode, contractor.referenceCode]),
		text([labels.period, statement.period.fromDay, statement.period.toDay]),
		text([labels.generated, statement.generatedAt]),
		[],
	];

	const header = [
		labels.rowType,
		labels.date,
		labels.start,
		labels.end,
		labels.project,
		labels.task,
		labels.workedMinutes,
		labels.awaitingApproval,
		labels.basis,
		labels.dayUnitRule,
		labels.rate,
		labels.currency,
		labels.units,
		labels.unit,
		labels.amount,
	];

	const rows: string[][] = [];
	for (const day of statement.days) {
		const pricing = day.pricing;
		rows.push([
			cell(labels.rowDay),
			cell(day.date),
			cell(""),
			cell(""),
			cell(""),
			cell(""),
			cell(day.workedMinutes),
			cell(""),
			cell(pricing ? basisLabel(labels, pricing.basis) : labels.noRate),
			cell(pricing?.dayUnitRule ? dayUnitRuleLabel(t, pricing.dayUnitRule) : ""),
			cell(pricing?.rate),
			cell(pricing?.currency),
			cell(pricing?.units),
			cell(pricing ? unitLabel(labels, pricing.unit) : ""),
			cell(pricing?.amount),
		]);
		for (const line of day.lines) {
			rows.push([
				cell(labels.rowWork),
				cell(day.date),
				cell(line.start),
				cell(line.end),
				cell(line.projectName),
				cell(line.taskName),
				cell(line.workedMinutes),
				cell(line.awaitingApproval ? labels.yes : labels.no),
				cell(""),
				cell(""),
				cell(""),
				cell(pricing?.currency),
				cell(""),
				cell(""),
				cell(line.amount),
			]);
		}
	}
	for (const total of statement.totals) {
		// Units only when the currency's days were all hourly or all daily.
		const hasHours = !/^0(\.0+)?$/.test(total.hours);
		const hasDays = !/^0(\.0+)?$/.test(total.days);
		const single = hasHours !== hasDays;
		rows.push([
			cell(labels.rowTotal),
			cell(""),
			cell(""),
			cell(""),
			cell(""),
			cell(""),
			cell(total.workedMinutes),
			cell(""),
			cell(""),
			cell(""),
			cell(""),
			cell(total.currency),
			cell(single ? (hasHours ? total.hours : total.days) : ""),
			cell(single ? (hasHours ? labels.hours : labels.days) : ""),
			cell(total.amount),
		]);
	}
	if (statement.unpriced.days > 0) {
		rows.push([
			cell(labels.rowUnpriced),
			...Array.from({ length: 5 }, () => cell("")),
			cell(statement.unpriced.workedMinutes),
			...Array.from({ length: 8 }, () => cell("")),
		]);
	}

	const file = csvFile(header, rows);
	const bom = file.slice(0, 1);
	const lines = preamble.map((row) => row.join(","));
	return `${bom}${lines.join("\r\n")}\r\n${file.slice(1)}`;
}

function slug(value: string): string {
	return (
		value
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "contractor"
	);
}

export function contractorStatementFilename(
	statement: Pick<ContractorStatement, "contractor" | "period">,
	extension: "csv" | "pdf",
): string {
	return `contractor-statement-${slug(statement.contractor.name)}-${statement.period.fromDay}-${statement.period.toDay}.${extension}`;
}
