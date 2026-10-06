import { createHash } from "node:crypto";
import type {
	TravelExpenseReportItemType,
	TravelExpenseReportKind,
} from "@/db/schema/travel-expense";
import type { AllowancePolicySource } from "@/lib/travel-expenses/allowance-policy";
import { TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER } from "@/lib/travel-expenses/attachment-validation";
import {
	calculateMileageItem,
	type MileageVehicle,
	parseMileageDistance,
	parseMileageRate,
	type StampedMileagePolicy,
} from "@/lib/travel-expenses/mileage";
import type { RoundingMode } from "@/lib/travel-expenses/money";
import {
	frozenReceiptException,
	receiptExceptionContext,
} from "@/lib/travel-expenses/receipt-exception";
import {
	type ExpensePayer,
	type ReceiptExpenseCategory,
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "@/lib/travel-expenses/receipt-report";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { tripReportMissingRequirements } from "@/lib/travel-expenses/trip-report";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import type { TravelExpenseMoney } from "./travel-expense-facts";

/**
 * Frozen submission of a travel expense report (#602). One submitted revision
 * holds every expense of the report with its exact receipt objects, the shared
 * trip facts and the server-calculated totals. Nothing is recalculated from a
 * later policy, currency or viewer zone: reviewers decide exactly these facts.
 */

/**
 * Version of newly frozen facts. Revisions of every version 1..current stay
 * readable (`travel-expense-report-store.ts`) and keep the version they were
 * frozen with. A version adds only optional facts, omitted (never `null` or
 * `undefined`) when they do not apply and emitted only when building at that
 * version or later, so an older revision stays byte-identical and compares
 * as `current` against unchanged live rows.
 */
export const TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION = 3;

/** Version 2 (#604) adds the optional `receiptException` of an item. */
const RECEIPT_EXCEPTION_SCHEMA_VERSION = 2;
/** Version 3 (#606) adds `mileage` to mileage items. */
const MILEAGE_FACTS_SCHEMA_VERSION = 3;

export interface TravelExpenseReportReceiptManifestItem {
	receiptId: string;
	itemId: string;
	object: { provider: string; bucket: string | null; key: string; versionId: string | null };
	checksumSha256: string;
	sizeBytes: number;
	mimeType: string;
}

export interface TravelExpenseReportSubmittedItem {
	itemId: string;
	position: number;
	type: TravelExpenseReportItemType;
	/** Calendar date printed on the receipt; it has no zone. */
	expenseDate: string;
	category: ReceiptExpenseCategory;
	description: string;
	original: TravelExpenseMoney;
	paidBy: ExpensePayer;
	accountingReference: string | null;
	receipts: TravelExpenseReportReceiptManifestItem[];
	/**
	 * Since v2 (#604): the employee's explanation of a missing receipt. Present
	 * only for an expense frozen without receipts while the organization allowed
	 * exceptions; approval must accept it explicitly.
	 */
	receiptException?: { reason: string };
	/**
	 * Mileage items only (v3+, #606): the entered trip and the policy version
	 * that priced it. Such an item also freezes `category: "transport"`, its
	 * route as `description` and the calculated amount as `original`, so every
	 * reader of item amounts keeps working.
	 */
	mileage?: TravelExpenseReportSubmittedMileage;
}

export interface TravelExpenseReportSubmittedMileage {
	route: string;
	distanceKm: string;
	vehicle: MileageVehicle;
	ratePerKm: string;
	currency: string;
	/** distance × rate, exact. */
	exactAmount: string;
	/** `exactAmount` rounded once with `rounding`; the item's reimbursement. */
	amount: string;
	rounding: RoundingMode;
	policy: {
		policyId: string;
		versionId: string;
		effectiveFrom: string;
		source: AllowancePolicySource;
	};
}

export interface TravelExpenseReportSubmittedFacts {
	/** The version these facts were frozen with: 1..`TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION`. */
	schemaVersion: number;
	kind: "travel_expense_report";
	organizationId: string;
	reportId: string;
	/** Which submission of the report this is; a resubmission is a new cycle. */
	submissionCycle: number;
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	reportKind: TravelExpenseReportKind;
	reimbursementCurrency: string;
	/** Travel dates are calendar days in `timeZone`, exactly as entered. Null when standalone. */
	trip: {
		purpose: string;
		startDate: string;
		endDate: string;
		timeZone: string;
		destinations: TripDestination[];
	} | null;
	items: TravelExpenseReportSubmittedItem[];
	totals: { currency: string; reimbursable: string; companyPaid: string };
}

export interface TravelExpenseReportFactsInput {
	report: {
		id: string;
		organizationId: string;
		employeeId: string;
		kind: TravelExpenseReportKind;
		reimbursementCurrency: string;
		submissionCount: number;
		tripPurpose: string | null;
		tripStartDate: string | null;
		tripEndDate: string | null;
		tripTimeZone: string | null;
		tripDestinations: TripDestination[];
	};
	items: ReadonlyArray<{
		id: string;
		organizationId: string;
		reportId: string;
		type: TravelExpenseReportItemType;
		position: number;
		expenseDate: string | null;
		category: ReceiptExpenseCategory | null;
		description: string | null;
		originalAmount: string | null;
		originalCurrency: string | null;
		paidBy: ExpensePayer | null;
		accountingReference: string | null;
		/** Mileage items (#606); absent or null otherwise. */
		mileageRoute?: string | null;
		mileageDistanceKm?: string | null;
		mileageVehicle?: MileageVehicle | null;
		/** The policy stamped under the report lock at submission. */
		mileagePolicy?: StampedMileagePolicy | null;
		/** Missing-receipt explanation (#604); null or absent when none was requested. */
		receiptExceptionReason?: string | null;
	}>;
	/** Whether the organization allowed missing-receipt exceptions when submitting (#604). */
	receiptExceptionsAllowed?: boolean;
	receipts: ReadonlyArray<{
		id: string;
		organizationId: string;
		reportId: string;
		itemId: string;
		storageProvider: string;
		storageBucket: string | null;
		storageKey: string;
		storageVersionId: string | null;
		checksumSha256: string;
		sizeBytes: number;
		mimeType: string;
	}>;
}

const MONEY_AMOUNT = /^\d{1,10}\.\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

function invariant(field: string): never {
	throw new ApprovalEvidenceError("invariant", { field });
}

function byId<T extends { id: string }>(left: T, right: T): number {
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function manifestItem(
	receipt: TravelExpenseReportFactsInput["receipts"][number],
): TravelExpenseReportReceiptManifestItem {
	if (receipt.storageProvider !== TRAVEL_EXPENSE_RECEIPT_STORAGE_PROVIDER) {
		incomplete("receipt_storage");
	}
	if (!SHA256_HEX.test(receipt.checksumSha256)) incomplete("receipt_checksum");
	return {
		receiptId: receipt.id,
		itemId: receipt.itemId,
		object: {
			provider: receipt.storageProvider,
			bucket: receipt.storageBucket,
			key: receipt.storageKey,
			versionId: receipt.storageVersionId,
		},
		checksumSha256: receipt.checksumSha256,
		sizeBytes: receipt.sizeBytes,
		mimeType: receipt.mimeType,
	};
}

function itemDraft(row: TravelExpenseReportFactsInput["items"][number]): ReceiptItemDraft {
	return {
		expenseDate: row.expenseDate,
		category: row.category,
		description: row.description,
		amount: row.originalAmount,
		currency: row.originalCurrency,
		paidBy: row.paidBy,
		accountingReference: row.accountingReference,
	};
}

/**
 * `submit` freezes only complete facts; `compare` snapshots live rows as they
 * are, so a later change of the completeness rules never re-validates (and
 * holds) a frozen revision whose facts did not change.
 */
type SnapshotMode = "submit" | "compare";

function liveTripFacts(
	report: TravelExpenseReportFactsInput["report"],
): TravelExpenseReportSubmittedFacts["trip"] {
	if (report.kind === "standalone") return null;
	return {
		purpose: report.tripPurpose,
		startDate: report.tripStartDate,
		endDate: report.tripEndDate,
		timeZone: report.tripTimeZone,
		destinations: report.tripDestinations.map((destination) => ({ ...destination })),
	} as TravelExpenseReportSubmittedFacts["trip"];
}

function tripFacts(
	report: TravelExpenseReportFactsInput["report"],
	itemCount: number,
): TravelExpenseReportSubmittedFacts["trip"] {
	if (report.kind === "standalone") {
		if (itemCount !== 1) incomplete("items");
		return null;
	}
	const { tripPurpose, tripStartDate, tripEndDate, tripTimeZone } = report;
	if (!tripTimeZone) incomplete("trip");
	const missing = tripReportMissingRequirements({
		details: {
			purpose: tripPurpose,
			startDate: tripStartDate,
			endDate: tripEndDate,
			timeZone: tripTimeZone,
			destinations: report.tripDestinations,
		},
		items: [],
		reimbursementCurrency: report.reimbursementCurrency,
	}).trip.filter((requirement) => requirement !== "expense_item");
	if (missing.length > 0 || !tripPurpose || !tripStartDate || !tripEndDate) incomplete("trip");
	if (itemCount < 1) incomplete("items");
	return {
		purpose: tripPurpose,
		startDate: tripStartDate,
		endDate: tripEndDate,
		timeZone: tripTimeZone,
		destinations: report.tripDestinations.map((destination) => ({ ...destination })),
	};
}

/**
 * A mileage item (#606) is priced from its entered distance and the policy
 * stamped on it at submission, never from today's policy: the compare
 * snapshot of an unchanged item therefore equals the frozen one even after
 * the organization changes its rates.
 */
function mileageItemFacts(
	row: TravelExpenseReportFactsInput["items"][number],
	receipts: TravelExpenseReportReceiptManifestItem[],
	reimbursementCurrency: string,
	mode: SnapshotMode,
	schemaVersion: number,
): TravelExpenseReportSubmittedItem {
	const route = row.mileageRoute ?? null;
	const distanceKm = row.mileageDistanceKm ?? null;
	const vehicle = row.mileageVehicle ?? null;
	const stamp = row.mileagePolicy ?? null;
	const { expenseDate } = row;
	// The stamp must have been resolved for exactly this date and vehicle.
	const calculation =
		stamp &&
		stamp.expenseDate === expenseDate &&
		stamp.vehicle === vehicle &&
		parseMileageRate(stamp.ratePerKm) === stamp.ratePerKm &&
		(distanceKm === null || parseMileageDistance(distanceKm) === distanceKm)
			? calculateMileageItem(
					{ expenseDate, distanceKm, vehicle },
					{ status: "found", policy: stamp },
					reimbursementCurrency,
				)
			: null;
	const calculated = calculation?.status === "calculated" ? calculation : null;
	if (
		mode === "submit" &&
		(!calculated || !expenseDate || !route || row.paidBy !== "employee")
	) {
		incomplete("mileage");
	}
	const mileage = calculated
		? {
				route,
				distanceKm: calculated.distanceKm,
				vehicle,
				ratePerKm: calculated.ratePerKm,
				currency: calculated.currency,
				exactAmount: calculated.exactAmount,
				amount: calculated.amount,
				rounding: calculated.rounding,
				policy: {
					policyId: calculated.policy.policyId,
					versionId: calculated.policy.versionId,
					effectiveFrom: calculated.policy.effectiveFrom,
					source: { ...calculated.policy.source },
				},
			}
		: // Compare mode only: live rows that cannot be priced as frozen differ from the revision.
			{ route, distanceKm, vehicle, stamp };
	return {
		itemId: row.id,
		position: row.position,
		type: row.type,
		expenseDate,
		category: "transport",
		description: route,
		original: { amount: calculated?.amount ?? null, currency: calculated?.currency ?? null },
		paidBy: row.paidBy,
		accountingReference: row.accountingReference,
		receipts,
		...(schemaVersion >= MILEAGE_FACTS_SCHEMA_VERSION
			? { mileage: mileage as TravelExpenseReportSubmittedMileage }
			: {}),
	} as TravelExpenseReportSubmittedItem;
}

/**
 * Builds the immutable submitted facts of one report from its persisted rows.
 * A row of another organization or report is an invariant breach; anything
 * incomplete throws instead of being frozen as a guess.
 */
export function buildTravelExpenseReportSubmittedFacts(
	input: TravelExpenseReportFactsInput,
): TravelExpenseReportSubmittedFacts {
	return snapshotReport(input, "submit", TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION);
}

/**
 * `schemaVersion` is the version the snapshot is built at: the current one
 * when submitting, the frozen revision's when comparing. Facts introduced by
 * a later version are emitted only when `schemaVersion` reaches it.
 */
function snapshotReport(
	input: TravelExpenseReportFactsInput,
	mode: SnapshotMode,
	schemaVersion: number,
): TravelExpenseReportSubmittedFacts {
	const enforce = mode === "submit";
	const { report } = input;
	for (const row of input.items) {
		if (row.organizationId !== report.organizationId || row.reportId !== report.id) {
			invariant("item_scope");
		}
	}
	const itemIds = new Set(input.items.map((row) => row.id));
	for (const row of input.receipts) {
		if (
			row.organizationId !== report.organizationId ||
			row.reportId !== report.id ||
			!itemIds.has(row.itemId)
		) {
			invariant("receipt_scope");
		}
	}
	if (enforce && !CURRENCY.test(report.reimbursementCurrency)) incomplete("currency");

	const items = input.items
		.toSorted((left, right) => left.position - right.position)
		.map((row): TravelExpenseReportSubmittedItem => {
			const receipts = input.receipts
				.filter((receipt) => receipt.itemId === row.id)
				.toSorted(byId)
				.map(manifestItem);
			if (row.type === "mileage") {
				return mileageItemFacts(row, receipts, report.reimbursementCurrency, mode, schemaVersion);
			}
			const draft = itemDraft(row);
			const missing = receiptItemMissingRequirements(draft, {
				receiptCount: receipts.length,
				reimbursementCurrency: report.reimbursementCurrency,
				receiptException: receiptExceptionContext(
					row.receiptExceptionReason ?? null,
					input.receiptExceptionsAllowed === true,
				),
			});
			const exception = frozenReceiptException(row.receiptExceptionReason, receipts.length);
			const exceptionFact =
				schemaVersion >= RECEIPT_EXCEPTION_SCHEMA_VERSION && exception
					? { receiptException: exception }
					: {};
			const { expenseDate, category, description, amount, currency, paidBy } = draft;
			if (!enforce) {
				return {
					itemId: row.id,
					position: row.position,
					type: row.type,
					expenseDate,
					category,
					description,
					original: { amount, currency },
					paidBy,
					accountingReference: row.accountingReference,
					receipts,
					...exceptionFact,
				} as TravelExpenseReportSubmittedItem;
			}
			if (
				missing.length > 0 ||
				!expenseDate ||
				!category ||
				!description ||
				!amount ||
				!currency ||
				!paidBy ||
				!MONEY_AMOUNT.test(amount)
			) {
				incomplete("items");
			}
			return {
				itemId: row.id,
				position: row.position,
				type: row.type,
				expenseDate,
				category,
				description,
				original: { amount, currency },
				paidBy,
				accountingReference: row.accountingReference,
				receipts,
				...exceptionFact,
			};
		});
	const trip = enforce ? tripFacts(report, items.length) : liveTripFacts(report);
	const totals = receiptReportTotals(
		items.map((item) => ({
			amount: item.original.amount,
			currency: item.original.currency,
			paidBy: item.paidBy,
		})),
		report.reimbursementCurrency,
	);
	if (enforce && totals.excludedItemCount > 0) incomplete("totals");

	return {
		schemaVersion,
		kind: "travel_expense_report",
		organizationId: report.organizationId,
		reportId: report.id,
		submissionCycle: report.submissionCount,
		subjectEmployeeId: report.employeeId,
		requesterEmployeeId: report.employeeId,
		reportKind: report.kind,
		reimbursementCurrency: report.reimbursementCurrency,
		trip,
		items,
		totals: {
			currency: totals.currency,
			reimbursable: totals.reimbursable,
			companyPaid: totals.companyPaid,
		},
	};
}

const MATERIAL_FIELDS = [
	"organizationId",
	"reportId",
	"submissionCycle",
	"subjectEmployeeId",
	"requesterEmployeeId",
	"reportKind",
	"reimbursementCurrency",
	"trip",
	"items",
	"totals",
] as const satisfies readonly (keyof TravelExpenseReportSubmittedFacts)[];

/** Versioned identity of the reviewed report, including receipt content identity. */
export function fingerprintTravelExpenseReportFacts(
	facts: TravelExpenseReportSubmittedFacts,
): string {
	const material = Object.fromEntries([
		["schemaVersion", facts.schemaVersion],
		["kind", facts.kind],
		...MATERIAL_FIELDS.map((field) => [field, facts[field]]),
	]);
	// The prefix is the version the facts were frozen with, never the current one.
	return `travel_expense_report:v${facts.schemaVersion}:${createHash("sha256")
		.update(canonicalJson(material))
		.digest("hex")}`;
}

export type TravelExpenseReportRevisionComparison =
	| { kind: "current" }
	| { kind: "material_change"; changedFields: string[] };

/**
 * Compares the live report rows with the frozen revision. Any difference of
 * facts, or live rows that break scope or receipt identity, holds the
 * decision; today's completeness rules are not re-applied to frozen facts.
 */
export function compareLiveTravelExpenseReportWithRevision(
	submitted: TravelExpenseReportSubmittedFacts,
	live: TravelExpenseReportFactsInput,
): TravelExpenseReportRevisionComparison {
	const { schemaVersion } = submitted;
	if (
		!Number.isInteger(schemaVersion) ||
		schemaVersion < 1 ||
		schemaVersion > TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION
	) {
		return { kind: "material_change", changedFields: ["unverifiable:schema_version"] };
	}
	let liveFacts: TravelExpenseReportSubmittedFacts;
	try {
		// Snapshot the live rows as the revision's version saw them.
		liveFacts = snapshotReport(live, "compare", schemaVersion);
	} catch (error) {
		if (!(error instanceof ApprovalEvidenceError)) throw error;
		return {
			kind: "material_change",
			changedFields: [`unverifiable:${error.details.field ?? error.code}`],
		};
	}
	const changedFields = MATERIAL_FIELDS.filter(
		(field) => canonicalJson(submitted[field]) !== canonicalJson(liveFacts[field]),
	);
	return changedFields.length > 0
		? { kind: "material_change", changedFields: [...changedFields] }
		: { kind: "current" };
}

/** Request-time descriptive labels. Never material and never outbound. */
export interface TravelExpenseReportSubmittedLabels {
	subjectName: string | null;
	submitterName: string | null;
	/** Uploaded file names by receipt ID; review-only. */
	receiptFileNames: Record<string, string>;
}
