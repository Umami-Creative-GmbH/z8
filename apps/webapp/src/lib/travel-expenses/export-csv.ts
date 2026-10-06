import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import {
	bundleReceiptPath,
	type TravelExpenseExportManifest,
	type TravelExpenseExportManifestRevision,
} from "./export-manifest";
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

function reimbursementInput(item: TravelExpenseReportSubmittedItem): ReimbursementItemInput {
	// #606/#607 add their frozen pricing facts (mileage, conversion) here, as
	// they do in `item-amount.ts`, so exports price items exactly as approved.
	return { amount: item.original.amount, currency: item.original.currency, paidBy: item.paidBy };
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringOf(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * Optional item facts of later schema versions. A receipt exception (#604,
 * v2) was accepted by the approving reviewer. Project attribution (#605) is
 * read defensively until its facts type is merged; replace it then.
 */
function optionalItemFacts(item: TravelExpenseReportSubmittedItem) {
	const project = recordOf((item as unknown as Record<string, unknown>).project);
	return {
		projectId: stringOf(project?.projectId),
		projectName: stringOf(project?.name),
		exceptionBasis: item.receiptException
			? `missing_receipt_exception: ${item.receiptException.reason}`
			: "",
	};
}

function itemCalculationBasis(item: TravelExpenseReportSubmittedItem): string {
	// Receipts count at their frozen original amount; #606 (mileage) and #607
	// (conversion) name their own basis here.
	return item.type === "receipt" ? "receipt_amount" : item.type;
}

interface PricedItem {
	item: TravelExpenseReportSubmittedItem;
	reimbursement: bigint;
	companyPaid: bigint;
}

/** Prices every item like the frozen totals did and proves they agree. */
function priceRevision(facts: TravelExpenseReportSubmittedFacts): PricedItem[] {
	const priced = facts.items.map((item): PricedItem => {
		const amount = itemReimbursementAmount(reimbursementInput(item), facts.totals.currency);
		if (!amount.counted) {
			throw new TravelExpenseExportContentError(
				"totals_mismatch",
				`Item ${item.itemId} cannot be priced (${amount.reason})`,
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

export const TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS = [
	"batch_id",
	"report_id",
	"revision_id",
	"submission_cycle",
	"revision_fingerprint",
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
	"receipt_count",
	"receipt_files",
] as const;

const REPORT_COLUMNS = [
	"batch_id",
	"report_id",
	"revision_id",
	"submission_cycle",
	"revision_fingerprint",
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
			const optional = optionalItemFacts(item);
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
				csvText(optional.exceptionBasis),
				csvText(item.accountingReference),
				csvText(optional.projectId),
				csvText(optional.projectName),
				csvInteger(item.receipts.length),
				csvText(paths.join("; ")),
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
		]);
	}
	return [
		{ path: "expenses.csv", content: csvFile(TRAVEL_EXPENSE_EXPORT_EXPENSE_COLUMNS, expenseRows) },
		{ path: "reports.csv", content: csvFile(REPORT_COLUMNS, reportRows) },
		{ path: "receipts.csv", content: csvFile(RECEIPT_COLUMNS, receiptRows) },
		{ path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
	];
}
