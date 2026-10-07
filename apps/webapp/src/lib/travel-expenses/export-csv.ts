import {
	MANUAL_RATE_EVIDENCE_FACTS_SCHEMA_VERSION,
	REFERENCE_RATE_FACTS_SCHEMA_VERSION,
} from "@/lib/approvals/evidence/travel-expense-report-conversion";
import {
	TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION,
	type TravelExpenseReportSubmittedFacts,
	type TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import { PER_DIEM_FACTS_SCHEMA_VERSION } from "@/lib/approvals/evidence/travel-expense-report-per-diem";
import type { ItemConversion } from "./currency-conversion";
import {
	ADJUSTMENT_EXPENSE_COLUMNS,
	ADJUSTMENT_REPORT_COLUMNS,
	adjustmentExpenseCells,
	adjustmentManifestProblem,
	adjustmentReportCells,
} from "./export-adjustment";
import {
	ALLOWANCE_OVERRIDE_COLUMNS,
	allowanceOverrideCells,
	allowanceOverrideManifestProblem,
	allowanceOverrideMatchesItem,
} from "./export-allowance-override";
import {
	bundleReceiptPath,
	type TravelExpenseExportManifest,
	type TravelExpenseExportManifestRevision,
} from "./export-manifest";
import {
	PER_DIEM_LOCATION_COLUMNS,
	perDiemLocationCells,
	perDiemLocationManifestProblem,
} from "./export-per-diem-locations";
import { itemReimbursementAmount, type ReimbursementItemInput } from "./item-amount";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";

/**
 * The expense-specific CSV contract of a travel expense export batch (#613).
 * It is not the payroll (DATEV/attendance) formatter: every money value has an
 * explicit currency column, dates are the logical calendar dates of the frozen
 * revision (never converted through any zone), and every text cell is
 * neutralized so a spreadsheet cannot run it as a formula. Money cells are
 * validated signed decimals and written unquoted, so a negative amount (#615
 * adjustments) stays a number instead of being escaped as a formula.
 *
 * Revisions of every frozen facts version 1..current are exported; facts a
 * version did not have (receipt exception v2, conversion v3, project v4,
 * mileage v5, reference-rate conversion v6, per diem v7, adjustment v8) leave their
 * columns empty (`record_type` reads `original`; `export-adjustment.ts`); an
 * allowance override (v9, `export-allowance-override.ts`) prices its item; a
 * manual rate's evidence reference (v11) fills the trailing
 * `conversion_rate_evidence` column. Items
 * are priced from their frozen pricing inputs and must add up to the frozen
 * totals.
 *
 * Files: `expenses.csv` (one row per expense item), `reports.csv` (one row per
 * revision with its frozen totals), `receipts.csv` (one row per bundled
 * receipt object) and `manifest.json` (the batch manifest itself). CSVs are
 * UTF-8 with a byte order mark and CRLF line endings (RFC 4180).
 */

export type TravelExpenseExportErrorCode =
	| "manifest_invalid"
	| "totals_mismatch"
	| "invalid_amount"
	| "receipt_unavailable"
	| "receipt_mismatch"
	| "storage_failed";

export class TravelExpenseExportContentError extends Error {
	constructor(
		readonly code: TravelExpenseExportErrorCode,
		message: string = code,
	) {
		super(message);
		this.name = "TravelExpenseExportContentError";
	}
}

/**
 * Leading characters spreadsheets treat as a formula (also after leading
 * whitespace), a leading tab or carriage return, and their full-width forms.
 */
const FORMULA_PREFIX = /^(?:[\t\r]|[\s]*[=+\-@＝＋－＠])/;
const SIGNED_DECIMAL = /^-?\d{1,12}\.\d{2}$/;
const BOM = "﻿";

/** A quoted text cell; formula-like text is prefixed with an apostrophe. */
export function csvText(value: string | number | null | undefined): string {
	const raw = value == null ? "" : String(value);
	const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
	return `"${safe.replaceAll('"', '""')}"`;
}

/** An unquoted money cell: a signed decimal at the stored scale, nothing else. */
export function csvDecimal(value: string): string {
	if (!SIGNED_DECIMAL.test(value)) {
		throw new TravelExpenseExportContentError("invalid_amount", `Not a stored amount: ${value}`);
	}
	return value;
}

/**
 * An unquoted non-negative plain decimal that is not a stored amount (a
 * distance, a rate per kilometre, an exchange rate, an exact product); empty
 * when the fact does not apply.
 */
const PLAIN_DECIMAL = /^\d{1,12}(?:\.\d{1,10})?$/;

function csvPlainDecimal(value: string | null | undefined): string {
	if (value == null) return "";
	if (!PLAIN_DECIMAL.test(value)) {
		throw new TravelExpenseExportContentError("invalid_amount", `Not a plain decimal: ${value}`);
	}
	return value;
}

/** An unquoted non-negative integer cell (counts, positions, sizes, cycles). */
function csvInteger(value: number): string {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TravelExpenseExportContentError("manifest_invalid", "Not a count");
	}
	return String(value);
}

function csvFile(header: readonly string[], rows: readonly (readonly string[])[]): string {
	const lines = [header.map(csvText).join(","), ...rows.map((row) => row.join(","))];
	return `${BOM}${lines.join("\r\n")}\r\n`;
}

/**
 * The frozen conversion (#607, v3+) as the item conversion it applied, so the
 * export prices the item through `item-amount.ts` exactly like the frozen
 * totals: a card charge counts at its evidenced charge, a manual rate (and a
 * reference rate, #608 v6+) is recomputed from its frozen rate and must give
 * the frozen result.
 */
function frozenItemConversion(
	item: TravelExpenseReportSubmittedItem,
	reimbursementCurrency: string,
): ItemConversion | null {
	const { conversion } = item;
	if (!conversion || !item.original.currency) return null;
	const pair = { sourceCurrency: item.original.currency, targetCurrency: reimbursementCurrency };
	if (conversion.basis === "card_charge") {
		return {
			...pair,
			basis: "card_charge",
			chargedAmount: conversion.reimbursement.amount,
			evidenceReceiptId: conversion.evidenceReceiptId,
		};
	}
	if (conversion.basis === "reference_rate") {
		const { rounding: _rounding, reimbursement: _reimbursement, ...reference } = conversion;
		return { ...pair, ...reference };
	}
	const { rounding: _rounding, reimbursement: _reimbursement, ...manual } = conversion;
	// The evidence reference (v11+) documents the rate; it never prices the item.
	return { ...pair, ...manual, evidence: manual.evidence ?? "" };
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A reference rate (#608) was chosen for the item's own expense date and is
 * the publication of that date or an earlier fallback, never a later one.
 */
function referenceRateMatchesItem(item: TravelExpenseReportSubmittedItem): boolean {
	const { conversion } = item;
	if (conversion?.basis !== "reference_rate") return true;
	return (
		conversion.expenseDate === item.expenseDate &&
		PLAIN_DATE.test(conversion.rateDate) &&
		PLAIN_DATE.test(conversion.expenseDate) &&
		conversion.rateDate <= conversion.expenseDate
	);
}

function reimbursementInput(
	item: TravelExpenseReportSubmittedItem,
	reimbursementCurrency: string,
): ReimbursementItemInput {
	// An administrator's override (#610, v9+) is what the allowance counts.
	const override = item.allowanceOverride;
	if (override) {
		const money = { amount: override.amount, currency: override.currency };
		return {
			amount: null,
			currency: null,
			paidBy: item.paidBy,
			type: override.kind,
			...(override.kind === "mileage" ? { mileage: money } : { perDiem: money }),
		};
	}
	return {
		amount: item.original.amount,
		currency: item.original.currency,
		paidBy: item.paidBy,
		conversion: frozenItemConversion(item, reimbursementCurrency),
		// A mileage item (#606, v5+) counts its policy-priced amount, never an entered one.
		...(item.mileage
			? {
					type: "mileage",
					mileage: { amount: item.mileage.amount, currency: item.mileage.currency },
				}
			: {}),
		// A per diem (#609, v7+) counts its calculated allowance, zero included.
		...(item.perDiem
			? {
					type: "per_diem",
					perDiem: { amount: item.perDiem.amount, currency: item.perDiem.currency },
				}
			: {}),
	};
}

/** What the item's frozen pricing facts say it counts with, if it has any. */
function frozenPricedAmount(item: TravelExpenseReportSubmittedItem): string | null {
	if (item.allowanceOverride) return item.allowanceOverride.amount;
	if (item.mileage) return item.mileage.amount;
	if (item.perDiem) return item.perDiem.amount;
	if (item.conversion) return item.conversion.reimbursement.amount;
	return null;
}

/**
 * How an item's reimbursement amount was derived: the frozen receipt amount,
 * a frozen conversion (#607) or a frozen mileage calculation (#606).
 */
function itemCalculationBasis(item: TravelExpenseReportSubmittedItem): string {
	if (item.allowanceOverride) return "allowance_override";
	if (item.mileage) return "mileage_rate";
	if (item.perDiem) return "per_diem_calculation";
	if (item.conversion) return "converted_amount";
	return item.type === "receipt" ? "receipt_amount" : item.type;
}

function exceptionBasis(item: TravelExpenseReportSubmittedItem): string {
	// A receipt exception (#604, v2+) was accepted by the approving reviewer.
	return item.receiptException ? `missing_receipt_exception: ${item.receiptException.reason}` : "";
}

interface PricedItem {
	item: TravelExpenseReportSubmittedItem;
	reimbursement: bigint;
	companyPaid: bigint;
}

/** Prices every item like the frozen totals did and proves they agree. */
function priceRevision(facts: TravelExpenseReportSubmittedFacts): PricedItem[] {
	const currency = facts.totals.currency;
	const priced = facts.items.map((item): PricedItem => {
		const amount = itemReimbursementAmount(reimbursementInput(item, currency), currency);
		if (!amount.counted) {
			throw new TravelExpenseExportContentError(
				"totals_mismatch",
				`Item ${item.itemId} cannot be priced (${amount.reason})`,
			);
		}
		// The frozen result (conversion or mileage) must be exactly the price
		// derived from its frozen inputs; a mileage item's totals counted its
		// `original`, which freezes the same calculated amount.
		const frozen = frozenPricedAmount(item);
		if (
			(frozen !== null && frozen !== amount.amount) ||
			(item.mileage && item.original.amount !== amount.amount) ||
			(item.perDiem &&
				(item.original.amount !== amount.amount || !perDiemDaysReconcile(item.perDiem))) ||
			(item.conversion && item.conversion.reimbursement.currency !== currency) ||
			!referenceRateMatchesItem(item) ||
			!allowanceOverrideMatchesItem(item, currency)
		) {
			throw new TravelExpenseExportContentError(
				"totals_mismatch",
				`Item ${item.itemId} does not match its frozen pricing facts`,
			);
		}
		const zero = BigInt(0);
		return {
			item,
			reimbursement: amount.paidBy === "employee" ? amount.units : zero,
			companyPaid: amount.paidBy === "company" ? amount.units : zero,
		};
	});
	const reimbursable = parseUnits(facts.totals.reimbursable, STORED_AMOUNT_SCALE);
	const companyPaid = parseUnits(facts.totals.companyPaid, STORED_AMOUNT_SCALE);
	if (
		reimbursable === null ||
		companyPaid === null ||
		sumUnits(priced.map((entry) => entry.reimbursement)) !== reimbursable ||
		sumUnits(priced.map((entry) => entry.companyPaid)) !== companyPaid
	) {
		throw new TravelExpenseExportContentError(
			"totals_mismatch",
			`Revision ${facts.reportId}/${facts.submissionCycle} does not add up to its frozen totals`,
		);
	}
	return priced;
}

/**
 * A frozen per diem (#609) adds up: each day is its rate less its applied
 * deductions (never more than the rate), and the days sum to the frozen amount.
 */
function perDiemDaysReconcile(
	perDiem: NonNullable<TravelExpenseReportSubmittedItem["perDiem"]>,
): boolean {
	const parse = (value: string) => parseUnits(value, STORED_AMOUNT_SCALE);
	const amounts: bigint[] = [];
	for (const day of perDiem.days) {
		const rate = parse(day.rate);
		const deductions = parse(day.deductions);
		const amount = parse(day.amount);
		if (rate === null || deductions === null || amount === null) return false;
		if (deductions < BigInt(0) || deductions > rate || amount !== rate - deductions) return false;
		amounts.push(amount);
	}
	return sumUnits(amounts) === parse(perDiem.amount);
}

function units(value: bigint): string {
	return csvDecimal(formatUnits(value, STORED_AMOUNT_SCALE));
}

function receiptPath(
	revision: TravelExpenseExportManifestRevision,
	item: TravelExpenseReportSubmittedItem,
	receipt: TravelExpenseReportSubmittedItem["receipts"][number],
) {
	return bundleReceiptPath({
		reportId: revision.reportId,
		itemPosition: item.position,
		receiptId: receipt.receiptId,
		fileName: revision.receiptFileNames[receipt.receiptId],
		mimeType: receipt.mimeType,
	});
}

/** Project attribution as approved (#605, v4+); `project_id`/`project_name` precede it. */
const PROJECT_COLUMNS = [
	"project_customer_id",
	"project_customer_name",
	"project_inherited_from_trip",
	"project_attribution_basis",
	"project_exception_id",
] as const;

/** The frozen conversion of a foreign-currency expense (#607, v3+). */
const CONVERSION_COLUMNS = [
	"conversion_basis",
	"conversion_result_amount",
	"conversion_result_currency",
	"conversion_rate_base",
	"conversion_rate_quote",
	"conversion_rate",
	"conversion_rate_date",
	"conversion_rounding",
	"conversion_evidence_receipt_id",
	"conversion_evidence_file",
	"conversion_authorized_by_employee_id",
	"conversion_authorized_by_name",
	"conversion_authorized_at",
	"conversion_reason",
	// A reference rate (#608, v6+): the publication applied, which can be an
	// earlier fallback than `expense_date`, and the approval it relied on.
	"conversion_reference_provider",
	"conversion_reference_publication_date",
	"conversion_reference_publication_id",
	"conversion_reference_publication_version",
	"conversion_reference_content_sha256",
	"conversion_reference_retrieved_at",
	"conversion_reference_policy_approved_at",
] as const;

/** The frozen calculation of a mileage expense (#606, v5+). */
const MILEAGE_COLUMNS = [
	"mileage_route",
	"mileage_distance_km",
	"mileage_vehicle",
	"mileage_rate_per_km",
	"mileage_rate_currency",
	"mileage_exact_amount",
	"mileage_rounding",
	"mileage_policy_id",
	"mileage_policy_version_id",
	"mileage_policy_effective_from",
	"mileage_policy_source",
	"mileage_policy_source_reference",
	"mileage_policy_source_version",
] as const;

/**
 * The frozen per diem calculation (#609, v7+): local travel times as entered
 * (calendar dates never shifted through a zone) with their UTC instants, the
 * rule edition and policy versions applied, and the daily breakdown.
 */
const PER_DIEM_COLUMNS = [
	"per_diem_start_date",
	"per_diem_start_time",
	"per_diem_start_time_zone",
	"per_diem_start_at",
	"per_diem_end_date",
	"per_diem_end_time",
	"per_diem_end_time_zone",
	"per_diem_end_at",
	"per_diem_overnight",
	"per_diem_absence_minutes",
	"per_diem_full_days",
	"per_diem_partial_days",
	"per_diem_allowance_before_meals",
	"per_diem_meal_deductions",
	"per_diem_amount",
	"per_diem_currency",
	"per_diem_rules_key",
	"per_diem_rules_reference",
	"per_diem_rules_version",
	"per_diem_policy_version_ids",
	"per_diem_policy_sources",
	"per_diem_days",
] as const;

/** The cells of `columns` in order; a fact that does not apply is an empty cell. */
function cellsOf<const Column extends string>(
	columns: readonly Column[],
	values: Partial<Record<Column, string>>,
): string[] {
	return columns.map((column) => values[column] ?? "");
}

const ITEM_PROJECT_COLUMNS = ["project_id", "project_name", ...PROJECT_COLUMNS] as const;

/** The approved project attribution (#605, v4+); empty when not attributed. */
function projectCells(item: TravelExpenseReportSubmittedItem): string[] {
	const { project } = item;
	if (!project) return cellsOf(ITEM_PROJECT_COLUMNS, {});
	return cellsOf(ITEM_PROJECT_COLUMNS, {
		project_id: csvText(project.projectId),
		project_name: csvText(project.name),
		project_customer_id: csvText(project.customerId),
		project_customer_name: csvText(project.customerName),
		project_inherited_from_trip: csvText(String(project.inheritedFromTrip)),
		project_attribution_basis: csvText(project.basis),
		project_exception_id: csvText(project.exception?.exceptionId),
	});
}

/**
 * The frozen conversion (#607 v3+, reference rate #608 v6+); empty for an
 * expense in the reimbursement currency.
 */
function conversionCells(
	revision: TravelExpenseExportManifestRevision,
	item: TravelExpenseReportSubmittedItem,
): string[] {
	const { conversion } = item;
	if (!conversion) return cellsOf(CONVERSION_COLUMNS, {});
	const result = {
		conversion_basis: csvText(conversion.basis),
		conversion_result_amount: csvDecimal(conversion.reimbursement.amount),
		conversion_result_currency: csvText(conversion.reimbursement.currency),
	};
	if (conversion.basis === "card_charge") {
		const evidence = item.receipts.find(
			(receipt) => receipt.receiptId === conversion.evidenceReceiptId,
		);
		return cellsOf(CONVERSION_COLUMNS, {
			...result,
			conversion_evidence_receipt_id: csvText(conversion.evidenceReceiptId),
			conversion_evidence_file: csvText(evidence ? receiptPath(revision, item, evidence) : null),
		});
	}
	const rate = {
		...result,
		conversion_rate_base: csvText(conversion.rate.base),
		conversion_rate_quote: csvText(conversion.rate.quote),
		conversion_rate: csvPlainDecimal(conversion.rate.value),
		// A calendar date as documented or published; never shifted through a zone.
		conversion_rate_date: csvText(conversion.rateDate),
		conversion_rounding: csvText(conversion.rounding.mode),
	};
	if (conversion.basis === "reference_rate") {
		const { source } = conversion;
		return cellsOf(CONVERSION_COLUMNS, {
			...rate,
			conversion_reference_provider: csvText(source.provider),
			conversion_reference_publication_date: csvText(conversion.rateDate),
			conversion_reference_publication_id: csvText(source.publicationId),
			conversion_reference_publication_version: csvInteger(source.publicationVersion),
			conversion_reference_content_sha256: csvText(source.contentSha256),
			conversion_reference_retrieved_at: csvText(source.retrievedAt),
			conversion_reference_policy_approved_at: csvText(source.policyApprovedAt),
		});
	}
	return cellsOf(CONVERSION_COLUMNS, {
		...rate,
		conversion_authorized_by_employee_id: csvText(conversion.authorizedBy.employeeId),
		conversion_authorized_by_name: csvText(conversion.authorizedBy.name),
		conversion_authorized_at: csvText(conversion.authorizedAt),
		conversion_reason: csvText(conversion.reason),
	});
}

/** An authorized manual rate's evidence reference (facts v11+). */
const RATE_EVIDENCE_COLUMNS = ["conversion_rate_evidence"] as const;

/** The frozen evidence reference of a manual rate (v11+); empty otherwise. */
function rateEvidenceCells(item: TravelExpenseReportSubmittedItem): string[] {
	const { conversion } = item;
	if (conversion?.basis !== "manual_rate" || !conversion.evidence) {
		return cellsOf(RATE_EVIDENCE_COLUMNS, {});
	}
	return cellsOf(RATE_EVIDENCE_COLUMNS, { conversion_rate_evidence: csvText(conversion.evidence) });
}

/** The frozen mileage calculation (#606, v5+); empty for any other expense. */
function mileageCells(item: TravelExpenseReportSubmittedItem): string[] {
	const { mileage } = item;
	if (!mileage) return cellsOf(MILEAGE_COLUMNS, {});
	return cellsOf(MILEAGE_COLUMNS, {
		mileage_route: csvText(mileage.route),
		mileage_distance_km: csvPlainDecimal(mileage.distanceKm),
		mileage_vehicle: csvText(mileage.vehicle),
		mileage_rate_per_km: csvPlainDecimal(mileage.ratePerKm),
		mileage_rate_currency: csvText(mileage.currency),
		mileage_exact_amount: csvPlainDecimal(mileage.exactAmount),
		mileage_rounding: csvText(mileage.rounding),
		mileage_policy_id: csvText(mileage.policy.policyId),
		mileage_policy_version_id: csvText(mileage.policy.versionId),
		mileage_policy_effective_from: csvText(mileage.policy.effectiveFrom),
		mileage_policy_source: csvText(mileage.policy.source.kind),
		mileage_policy_source_reference: csvText(mileage.policy.source.reference),
		mileage_policy_source_version: csvText(mileage.policy.source.version),
	});
}

/** The frozen per diem (#609, v7+); empty for any other expense. */
function perDiemCells(item: TravelExpenseReportSubmittedItem): string[] {
	const { perDiem } = item;
	if (!perDiem) return cellsOf(PER_DIEM_COLUMNS, {});
	const { days } = perDiem;
	const total = (pick: (day: (typeof days)[number]) => string) =>
		units(sumUnits(days.map((day) => parseUnits(pick(day), STORED_AMOUNT_SCALE) ?? ZERO)));
	const count = (allowance: string) =>
		csvInteger(days.filter((day) => day.allowance === allowance).length);
	return cellsOf(PER_DIEM_COLUMNS, {
		per_diem_start_date: csvText(perDiem.start.date),
		per_diem_start_time: csvText(perDiem.start.time),
		per_diem_start_time_zone: csvText(perDiem.start.timeZone),
		per_diem_start_at: csvText(perDiem.start.at),
		per_diem_end_date: csvText(perDiem.end.date),
		per_diem_end_time: csvText(perDiem.end.time),
		per_diem_end_time_zone: csvText(perDiem.end.timeZone),
		per_diem_end_at: csvText(perDiem.end.at),
		per_diem_overnight: csvText(perDiem.overnight),
		per_diem_absence_minutes: csvInteger(perDiem.absenceMinutes),
		per_diem_full_days: count("full_day"),
		per_diem_partial_days: count("partial_day"),
		per_diem_allowance_before_meals: total((day) => day.rate),
		per_diem_meal_deductions: total((day) => day.deductions),
		per_diem_amount: csvDecimal(perDiem.amount),
		per_diem_currency: csvText(perDiem.currency),
		per_diem_rules_key: csvText(perDiem.rules.key),
		per_diem_rules_reference: csvText(perDiem.rules.reference),
		per_diem_rules_version: csvText(perDiem.rules.version),
		per_diem_policy_version_ids: csvText(
			perDiem.policies.map((policy) => policy.versionId).join("; "),
		),
		per_diem_policy_sources: csvText(
			perDiem.policies
				.map((policy) => [policy.source.kind, policy.source.reference].filter(Boolean).join(": "))
				.join("; "),
		),
		// One entry per calendar day: date, allowance, rate - deductions = amount.
		per_diem_days: csvText(
			perDiem.days
				.map((day) => `${day.date} ${day.allowance} ${day.rate}-${day.deductions}=${day.amount}`)
				.join("; "),
		),
	});
}

const ZERO = BigInt(0);

export const TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS = [
	"batch_id",
	"report_id",
	"revision_id",
	"submission_cycle",
	"revision_fingerprint",
	"facts_schema_version",
	"approved_at",
	"employee_id",
	"employee_name",
	"report_kind",
	"trip_purpose",
	"trip_start_date",
	"trip_end_date",
	"trip_time_zone",
	"trip_destinations",
	"item_id",
	"item_position",
	"item_type",
	"expense_date",
	"category",
	"description",
	"paid_by",
	"original_amount",
	"original_currency",
	"reimbursement_amount",
	"company_paid_amount",
	"reimbursement_currency",
	"calculation_basis",
	"exception_basis",
	"accounting_reference",
	"project_id",
	"project_name",
	...PROJECT_COLUMNS,
	...CONVERSION_COLUMNS,
	...MILEAGE_COLUMNS,
	...PER_DIEM_COLUMNS,
	"receipt_count",
	"receipt_files",
	...ADJUSTMENT_EXPENSE_COLUMNS,
	...ALLOWANCE_OVERRIDE_COLUMNS,
	...PER_DIEM_LOCATION_COLUMNS,
	// Appended (v11+) so earlier column positions stay stable.
	...RATE_EVIDENCE_COLUMNS,
] as const;

const REPORT_COLUMNS = [
	"batch_id",
	"report_id",
	"revision_id",
	"submission_cycle",
	"revision_fingerprint",
	"facts_schema_version",
	"approved_at",
	"employee_id",
	"employee_name",
	"report_kind",
	"trip_purpose",
	"trip_start_date",
	"trip_end_date",
	"trip_time_zone",
	"currency",
	"reimbursable_total",
	"company_paid_total",
	"item_count",
	"receipt_count",
	...ADJUSTMENT_REPORT_COLUMNS,
] as const;

const RECEIPT_COLUMNS = [
	"report_id",
	"revision_id",
	"item_id",
	"receipt_id",
	"bundle_path",
	"file_name",
	"mime_type",
	"size_bytes",
	"checksum_sha256",
	"storage_key",
	"storage_version_id",
] as const;

function revisionColumns(
	manifest: TravelExpenseExportManifest,
	revision: TravelExpenseExportManifestRevision,
) {
	const { facts } = revision;
	return [
		csvText(manifest.batchId),
		csvText(revision.reportId),
		csvText(revision.revisionId),
		csvInteger(revision.submissionCycle),
		csvText(revision.materialFingerprint),
		csvInteger(facts.schemaVersion),
		csvText(revision.approvedAt),
		csvText(revision.employeeId),
		csvText(revision.employeeName),
		csvText(facts.reportKind),
		csvText(facts.trip?.purpose),
		csvText(facts.trip?.startDate),
		csvText(facts.trip?.endDate),
		csvText(facts.trip?.timeZone),
	];
}

function assertManifest(manifest: TravelExpenseExportManifest): void {
	for (const revision of manifest.revisions) {
		const { facts } = revision;
		// Every frozen version this contract knows: a later version may add
		// facts the CSV would silently drop, so it must be mapped here first.
		if (
			!Number.isInteger(facts.schemaVersion) ||
			facts.schemaVersion < 1 ||
			facts.schemaVersion > TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION
		) {
			throw new TravelExpenseExportContentError(
				"manifest_invalid",
				`Unsupported facts schema version ${facts.schemaVersion}`,
			);
		}
		if (
			facts.organizationId !== manifest.organizationId ||
			facts.reportId !== revision.reportId ||
			facts.submissionCycle !== revision.submissionCycle ||
			facts.subjectEmployeeId !== revision.employeeId
		) {
			throw new TravelExpenseExportContentError(
				"manifest_invalid",
				"Manifest revision out of scope",
			);
		}
		// A per diem (#609) cannot be frozen below the version that admits it.
		if (
			facts.schemaVersion < PER_DIEM_FACTS_SCHEMA_VERSION &&
			facts.items.some((item) => item.perDiem || item.type === "per_diem")
		) {
			throw new TravelExpenseExportContentError(
				"manifest_invalid",
				`Per diem in facts schema version ${facts.schemaVersion}`,
			);
		}
		// A reference-rate conversion cannot be frozen below the version that admits it.
		if (
			facts.schemaVersion < REFERENCE_RATE_FACTS_SCHEMA_VERSION &&
			facts.items.some((item) => item.conversion?.basis === "reference_rate")
		) {
			throw new TravelExpenseExportContentError(
				"manifest_invalid",
				`Reference rate conversion in facts schema version ${facts.schemaVersion}`,
			);
		}
		// A manual rate freezes its evidence reference exactly from version 11 on.
		if (
			facts.items.some(
				(item) =>
					item.conversion?.basis === "manual_rate" &&
					facts.schemaVersion >= MANUAL_RATE_EVIDENCE_FACTS_SCHEMA_VERSION !==
						Boolean(item.conversion.evidence?.trim()),
			)
		) {
			throw new TravelExpenseExportContentError(
				"manifest_invalid",
				`Manual rate evidence does not match facts schema version ${facts.schemaVersion}`,
			);
		}
		const adjustmentProblem = adjustmentManifestProblem(facts);
		if (adjustmentProblem) {
			throw new TravelExpenseExportContentError("manifest_invalid", adjustmentProblem);
		}
		const locationProblem = perDiemLocationManifestProblem(facts);
		if (locationProblem) {
			throw new TravelExpenseExportContentError("manifest_invalid", locationProblem);
		}
		const overrideProblem = allowanceOverrideManifestProblem(facts);
		if (overrideProblem) {
			throw new TravelExpenseExportContentError("manifest_invalid", overrideProblem);
		}
	}
}

export interface TravelExpenseExportTextFile {
	path: string;
	content: string;
}

/** Builds the CSV files and the manifest copy of one batch, deterministically. */
export function buildTravelExpenseExportFiles(
	manifest: TravelExpenseExportManifest,
): TravelExpenseExportTextFile[] {
	assertManifest(manifest);
	const expenseRows: string[][] = [];
	const reportRows: string[][] = [];
	const receiptRows: string[][] = [];
	for (const revision of manifest.revisions) {
		const { facts } = revision;
		const priced = priceRevision(facts);
		const shared = revisionColumns(manifest, revision);
		let receiptCount = 0;
		for (const { item, reimbursement, companyPaid } of priced) {
			const paths = item.receipts.map((receipt) => receiptPath(revision, item, receipt));
			receiptCount += item.receipts.length;
			expenseRows.push([
				...shared,
				csvText(facts.trip?.destinations.map((d) => `${d.place} (${d.countryCode})`).join("; ")),
				csvText(item.itemId),
				csvInteger(item.position),
				csvText(item.type),
				csvText(item.expenseDate),
				csvText(item.category),
				csvText(item.description),
				csvText(item.paidBy),
				csvDecimal(item.original.amount),
				csvText(item.original.currency),
				units(reimbursement),
				units(companyPaid),
				csvText(facts.totals.currency),
				csvText(itemCalculationBasis(item)),
				csvText(exceptionBasis(item)),
				csvText(item.accountingReference),
				...projectCells(item),
				...conversionCells(revision, item),
				...mileageCells(item),
				...perDiemCells(item),
				csvInteger(item.receipts.length),
				csvText(paths.join("; ")),
				...adjustmentExpenseCells(facts, { text: csvText, decimal: csvDecimal }),
				...allowanceOverrideCells(item, {
					text: csvText,
					decimal: csvDecimal,
					plainDecimal: csvPlainDecimal,
				}),
				...perDiemLocationCells(item, { text: csvText, integer: csvInteger }),
				...rateEvidenceCells(item),
			]);
			item.receipts.forEach((receipt, index) => {
				receiptRows.push([
					csvText(revision.reportId),
					csvText(revision.revisionId),
					csvText(item.itemId),
					csvText(receipt.receiptId),
					csvText(paths[index]),
					csvText(revision.receiptFileNames[receipt.receiptId]),
					csvText(receipt.mimeType),
					csvInteger(receipt.sizeBytes),
					csvText(receipt.checksumSha256),
					csvText(receipt.object.key),
					csvText(receipt.object.versionId),
				]);
			});
		}
		reportRows.push([
			...shared,
			csvText(facts.totals.currency),
			csvDecimal(facts.totals.reimbursable),
			csvDecimal(facts.totals.companyPaid),
			csvInteger(facts.items.length),
			csvInteger(receiptCount),
			...adjustmentReportCells(facts, { text: csvText, decimal: csvDecimal }),
		]);
	}
	return [
		{ path: "expenses.csv", content: csvFile(TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS, expenseRows) },
		{ path: "reports.csv", content: csvFile(REPORT_COLUMNS, reportRows) },
		{ path: "receipts.csv", content: csvFile(RECEIPT_COLUMNS, receiptRows) },
		{ path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
	];
}
