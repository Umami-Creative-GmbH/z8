import type { CompensationBasis } from "@/lib/contractor-compensation/terms";
import type { ContractorUnits } from "@/lib/contractor-compensation/pricing";

/**
 * The words of the Contractor Time & Fee Statement (#2000) in the exporter's
 * language, shared by the CSV and the PDF. Keys live in the `common`
 * namespace so the server (full catalog), Employee Detail and Time Tracking
 * all load them. Each key has one static `t()` call with its English default.
 */

/** Tolgee's `t` in the language of the person exporting the statement. */
export type StatementTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

export function statementLabels(t: StatementTranslate) {
	return {
		title: t("common:contractorStatement.title", "Contractor Time & Fee Verification Statement"),
		notice: t(
			"common:contractorStatement.notice",
			"Verification statement only. Not an invoice or self-billing credit note (Gutschrift): Z8 never issues invoices. It lists the work recorded in Z8 and what the contractor's agreed rates price it at, so an invoice can be checked against it.",
		),
		organization: t("common:contractorStatement.organization", "Organization"),
		contractor: t("common:contractorStatement.contractor", "Contractor"),
		contractorNumber: t("common:contractorStatement.contractorNumber", "Contractor number"),
		company: t("common:contractorStatement.company", "Company"),
		vatId: t("common:contractorStatement.vatId", "VAT ID"),
		referenceCode: t("common:contractorStatement.referenceCode", "PO or cost-center reference"),
		period: t("common:contractorStatement.period", "Period"),
		generated: t("common:contractorStatement.generated", "Generated (UTC)"),
		rowType: t("common:contractorStatement.columns.rowType", "Row type"),
		date: t("common:contractorStatement.columns.date", "Date"),
		start: t("common:contractorStatement.columns.start", "Start"),
		end: t("common:contractorStatement.columns.end", "End"),
		time: t("common:contractorStatement.columns.time", "Time (local)"),
		project: t("common:contractorStatement.columns.project", "Project"),
		task: t("common:contractorStatement.columns.task", "Task"),
		workedMinutes: t("common:contractorStatement.columns.workedMinutes", "Worked minutes"),
		basis: t("common:contractorStatement.columns.basis", "Paid by"),
		dayUnitRule: t("common:contractorStatement.columns.dayUnitRule", "Day-unit rule"),
		rate: t("common:contractorStatement.columns.rate", "Rate"),
		currency: t("common:contractorStatement.columns.currency", "Currency"),
		units: t("common:contractorStatement.columns.units", "Units"),
		unit: t("common:contractorStatement.columns.unit", "Unit"),
		amount: t("common:contractorStatement.columns.amount", "Amount"),
		rowDay: t("common:contractorStatement.rows.day", "Day"),
		rowWork: t("common:contractorStatement.rows.work", "Work"),
		rowTotal: t("common:contractorStatement.rows.total", "Total"),
		rowUnpriced: t("common:contractorStatement.rows.unpriced", "Unpriced"),
		noRate: t("common:contractorStatement.noRate", "No rate applies"),
		hours: t("common:contractorStatement.units.hours", "Hours"),
		days: t("common:contractorStatement.units.days", "Days"),
		hourly: t("common:contractorStatement.basis.hourly", "Hourly rate"),
		daily: t("common:contractorStatement.basis.daily", "Day rate"),
		noProject: t("common:contractorStatement.noProject", "No project"),
		totals: t("common:contractorStatement.totals", "Totals"),
		byProject: t("common:contractorStatement.byProject", "By project"),
		workedHours: t("common:contractorStatement.workedHours", "Worked hours"),
		page: t("common:contractorStatement.page", "Page"),
		times: t(
			"common:contractorStatement.times",
			"Days are the contractor's local calendar days; times are shown at the UTC offset recorded with the work.",
		),
		unpricedNotice: t(
			"common:contractorStatement.unpricedNotice",
			"Some work had no agreed rate on its day. It is listed without an amount and is not in the totals.",
		),
		approvedOnly: t(
			"common:contractorStatement.approvedOnly",
			"Only approved work is listed. Work awaiting approval is added once it is approved.",
		),
		empty: t(
			"common:contractorStatement.empty",
			"No completed work as External Contractor in this period.",
		),
	};
}

export type StatementLabels = ReturnType<typeof statementLabels>;

export function basisLabel(labels: StatementLabels, basis: CompensationBasis): string {
	return basis === "hourly" ? labels.hourly : labels.daily;
}

export function unitLabel(labels: StatementLabels, unit: ContractorUnits["unit"]): string {
	return unit === "hour" ? labels.hours : labels.days;
}

/** "Work periods awaiting approval, not included: 2". */
export function awaitingApprovalNotice(t: StatementTranslate, count: number): string {
	return t(
		"common:contractorStatement.awaitingApprovalExcluded",
		"Work periods awaiting approval, not included: {count}",
		{ count },
	);
}
