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
import { effectiveItemProject } from "@/lib/travel-expenses/project-attribution";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { tripReportMissingRequirements } from "@/lib/travel-expenses/trip-report";
import type { AdjustmentBaseline } from "@/lib/travel-expenses/adjustment";
import { canonicalJson } from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import {
	adjustmentSnapshot,
	type TravelExpenseReportAdjustmentLink,
	type TravelExpenseReportSubmittedAdjustment,
} from "./travel-expense-report-adjustment";
import {
	applyingMileageOverride,
	applyingPerDiemOverride,
	assertAllowanceOverrideScope,
	submittedAllowanceOverride,
	type TravelExpenseReportAllowanceOverrideRow,
	type TravelExpenseReportSubmittedAllowanceOverride,
} from "./travel-expense-report-allowance-override";
import type { TravelExpenseMoney } from "./travel-expense-facts";
import {
	assertPerDiemScope,
	PER_DIEM_FACTS_DESCRIPTION,
	PER_DIEM_FACTS_SCHEMA_VERSION,
	submittedPerDiemFacts,
	type TravelExpenseReportPerDiemRow,
	type TravelExpenseReportSubmittedPerDiem,
} from "./travel-expense-report-per-diem";
import {
	assertConversionScope,
	submittedConversionFacts,
	type TravelExpenseReportConversionRow,
	type TravelExpenseReportSubmittedConversion,
} from "./travel-expense-report-conversion";

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
export const TRAVEL_EXPENSE_REPORT_EVIDENCE_SCHEMA_VERSION = 11;

/** Version 2 (#604) adds the optional `receiptException` of an item. */
const RECEIPT_EXCEPTION_SCHEMA_VERSION = 2;
/* Version 3 (#607) adds the optional `conversion` of an item (`CONVERSION_FACTS_SCHEMA_VERSION`). */

/** Version 4 (#605) adds an expense's project attribution (`project`). */
const PROJECT_ATTRIBUTION_SCHEMA_VERSION = 4;
/** Version 5 (#606) adds `mileage` to mileage items. */
const MILEAGE_FACTS_SCHEMA_VERSION = 5;
/* Version 6 (#608) admits the `reference_rate` conversion basis (`REFERENCE_RATE_FACTS_SCHEMA_VERSION`). */
/* Version 7 (#609) adds `perDiem` to per diem items (`PER_DIEM_FACTS_SCHEMA_VERSION`). */
/* Version 8 (#615) adds the root `adjustment` of an adjustment report (`ADJUSTMENT_FACTS_SCHEMA_VERSION`). */
/* Version 9 (#610) adds an item's `allowanceOverride` (`ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION`). */
/* Version 10 (#611) adds per diem daily locations (`PER_DIEM_LOCATION_FACTS_SCHEMA_VERSION`). */
/* Version 11 adds a manual rate's `evidence` (`MANUAL_RATE_EVIDENCE_FACTS_SCHEMA_VERSION`). */

/**
 * The accounting attribution of one expense as it was submitted (#605): the
 * project's identity and names at submission, whether the expense inherited
 * the trip's project, and how the employee's use of the project on the
 * expense date was proven. Later renames, closures or assignment changes
 * never rewrite it.
 */
export interface TravelExpenseReportProjectAttribution {
	projectId: string;
	name: string;
	customerId: string | null;
	customerName: string | null;
	inheritedFromTrip: boolean;
	basis: "employee_assignment" | "team_assignment" | "exception";
	/** The authorized exception, only when `basis` is `exception`. */
	exception?: {
		exceptionId: string;
		validFrom: string;
		validTo: string;
		reason: string;
		evidence: string;
		authorizedByEmployeeId: string;
		/** Canonical UTC instant. */
		authorizedAt: string;
	};
}

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
	/** Since v3 (#607): how a foreign-currency expense was converted; absent otherwise. */
	conversion?: TravelExpenseReportSubmittedConversion;
	/** Since v4 (#605): present only when the expense is attributed to a project. */
	project?: TravelExpenseReportProjectAttribution;
	/**
	 * Mileage items only (v5+, #606): the entered trip and the policy version
	 * that priced it. Such an item also freezes `category: "transport"`, its
	 * route as `description` and the calculated amount as `original`, so every
	 * reader of item amounts keeps working.
	 */
	mileage?: TravelExpenseReportSubmittedMileage;
	/**
	 * Per diem items only (v7+, #609): itinerary, meals, the stamped rule edition
	 * and policy versions, and the daily breakdown. The item also freezes
	 * `category: "meals"`, a fixed description and the calculated amount (possibly
	 * "0.00") as `original`.
	 */
	perDiem?: TravelExpenseReportSubmittedPerDiem;
	/**
	 * Since v9 (#610), mileage and per diem items only: the expense
	 * administrator's manual allowance, which `original` then holds. `mileage`
	 * or `perDiem` beside it is the ordinary result, present only when the
	 * stamped policy could price the facts.
	 */
	allowanceOverride?: TravelExpenseReportSubmittedAllowanceOverride;
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
	/** Since v8 (#615): present only on an adjustment report. */
	adjustment?: TravelExpenseReportSubmittedAdjustment;
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
		/** The trip's project, which inheriting expenses use (#605). */
		projectId?: string | null;
	};
	/**
	 * Resolved attribution by item ID for every attributed expense, required
	 * when submitting; comparing reads project IDs from the live rows only.
	 */
	projectAttribution?: Readonly<Record<string, TravelExpenseReportProjectAttribution>>;
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
		projectId?: string | null;
		projectInherits?: boolean;
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
	/** Saved conversions of foreign-currency items (#607). */
	conversions?: ReadonlyArray<TravelExpenseReportConversionRow>;
	/** Per diem itineraries of per diem items (#609). */
	perDiems?: ReadonlyArray<TravelExpenseReportPerDiemRow>;
	/** Active administrator overrides of allowance items (#610). */
	allowanceOverrides?: ReadonlyArray<TravelExpenseReportAllowanceOverrideRow>;
	/** The report it corrects when this is an adjustment report (#615). */
	adjustment?: TravelExpenseReportAdjustmentLink | null;
	/** Submitting an adjustment: the baseline resolved under the original's lock. */
	adjustmentBaseline?: AdjustmentBaseline;
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

/**
 * The `project` key of one expense, emitted from v4 on and only when the
 * expense is attributed. Submitting requires the attribution resolved for
 * exactly the live project; comparing checks the live project identity and
 * keeps the frozen names, so a later rename is not a change of the report.
 */
function projectFacts(
	input: TravelExpenseReportFactsInput,
	row: TravelExpenseReportFactsInput["items"][number],
	mode: SnapshotMode,
	schemaVersion: number,
	frozen: TravelExpenseReportSubmittedFacts | undefined,
): { project?: TravelExpenseReportProjectAttribution } {
	if (schemaVersion < PROJECT_ATTRIBUTION_SCHEMA_VERSION) return {};
	const effective = effectiveItemProject(input.report, row);
	if (!effective) return {};
	const matches = (attribution: TravelExpenseReportProjectAttribution | undefined) =>
		attribution?.projectId === effective.projectId &&
		attribution.inheritedFromTrip === effective.inheritedFromTrip;
	if (mode === "submit") {
		const resolved = input.projectAttribution?.[row.id];
		if (!resolved || !matches(resolved)) incomplete("project_attribution");
		return { project: structuredClone(resolved) };
	}
	const submitted = frozen?.items.find((item) => item.itemId === row.id)?.project;
	if (submitted && matches(submitted)) return { project: submitted };
	return { project: effective as unknown as TravelExpenseReportProjectAttribution };
}

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
	allowanceOverrides?: ReadonlyArray<TravelExpenseReportAllowanceOverrideRow>,
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
	// An administrator's override (#610) prices the item instead; the facts stay required.
	const override = applyingMileageOverride(
		allowanceOverrides,
		row,
		reimbursementCurrency,
		schemaVersion,
		calculation,
	);
	if (
		mode === "submit" &&
		((!calculated && !override) || !expenseDate || !route || row.paidBy !== "employee")
	) {
		incomplete("mileage");
	}
	if (override) {
		return {
			itemId: row.id,
			position: row.position,
			type: row.type,
			expenseDate,
			category: "transport",
			description: route,
			original: { amount: override.amount, currency: override.currency },
			paidBy: row.paidBy,
			accountingReference: row.accountingReference,
			receipts,
			// The ordinary result beside the override, only when the stamped policy priced it.
			...(calculated
				? {
						mileage: {
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
						},
					}
				: {}),
			allowanceOverride: submittedAllowanceOverride(override),
		} as TravelExpenseReportSubmittedItem;
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
 * A per diem item (#609) is calculated from its entered itinerary and the
 * rule edition and policy versions stamped at submission, never from today's
 * policy or overlap check. Submitting also requires the itinerary to match
 * the trip's travel dates.
 */
function perDiemItemFacts(
	input: TravelExpenseReportFactsInput,
	row: TravelExpenseReportFactsInput["items"][number],
	receipts: TravelExpenseReportReceiptManifestItem[],
	mode: SnapshotMode,
	schemaVersion: number,
): TravelExpenseReportSubmittedItem {
	const { report } = input;
	const perDiemRow = input.perDiems?.find((candidate) => candidate.itemId === row.id);
	const perDiem = submittedPerDiemFacts(perDiemRow, report, schemaVersion);
	// An administrator's override (#610) prices the per diem; the itinerary must still match the trip.
	const override = applyingPerDiemOverride(
		input.allowanceOverrides,
		perDiemRow,
		report,
		schemaVersion,
	);
	if (
		mode === "submit" &&
		((!perDiem && !override) ||
			row.paidBy !== "employee" ||
			report.kind !== "trip" ||
			(perDiem?.start.date ?? perDiemRow?.startDate) !== report.tripStartDate ||
			(perDiem?.end.date ?? perDiemRow?.endDate) !== report.tripEndDate)
	) {
		incomplete("per_diem");
	}
	if (override) {
		return {
			itemId: row.id,
			position: row.position,
			type: row.type,
			expenseDate: perDiemRow?.startDate ?? row.expenseDate,
			category: "meals",
			description: PER_DIEM_FACTS_DESCRIPTION,
			original: { amount: override.amount, currency: override.currency },
			paidBy: row.paidBy,
			accountingReference: row.accountingReference,
			receipts,
			// The ordinary daily breakdown beside the override, only when the stamp priced it.
			...(perDiem ? { perDiem } : {}),
			allowanceOverride: submittedAllowanceOverride(override),
		} as TravelExpenseReportSubmittedItem;
	}
	return {
		itemId: row.id,
		position: row.position,
		type: row.type,
		expenseDate: perDiem?.start.date ?? row.expenseDate,
		category: "meals",
		description: PER_DIEM_FACTS_DESCRIPTION,
		original: { amount: perDiem?.amount ?? null, currency: perDiem?.currency ?? null },
		paidBy: row.paidBy,
		accountingReference: row.accountingReference,
		receipts,
		...(schemaVersion >= PER_DIEM_FACTS_SCHEMA_VERSION
			? // Compare mode only: live rows that cannot be priced as stamped differ from the revision.
				{ perDiem: perDiem ?? { unpriced: perDiemRow ?? null } }
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
	frozen?: TravelExpenseReportSubmittedFacts,
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
	const conversions = input.conversions ?? [];
	assertConversionScope(conversions, report, itemIds);
	assertPerDiemScope(input.perDiems ?? [], report, input.items);
	assertAllowanceOverrideScope(input.allowanceOverrides ?? [], report, input.items);
	const conversionOf = (itemId: string) =>
		conversions.find((row) => row.itemId === itemId)?.conversion ?? null;
	if (enforce && !CURRENCY.test(report.reimbursementCurrency)) incomplete("currency");

	const items = input.items
		.toSorted((left, right) => left.position - right.position)
		.map((row): TravelExpenseReportSubmittedItem => {
			const receipts = input.receipts
				.filter((receipt) => receipt.itemId === row.id)
				.toSorted(byId)
				.map(manifestItem);
			if (row.type === "per_diem") {
				return {
					...perDiemItemFacts(input, row, receipts, mode, schemaVersion),
					...projectFacts(input, row, mode, schemaVersion, frozen),
				};
			}
			if (row.type === "mileage") {
				return {
					...mileageItemFacts(
						row,
						receipts,
						report.reimbursementCurrency,
						mode,
						schemaVersion,
						input.allowanceOverrides,
					),
					// A mileage expense is attributed like any other (#605).
					...projectFacts(input, row, mode, schemaVersion, frozen),
				};
			}
			const draft = itemDraft(row);
			const missing = receiptItemMissingRequirements(draft, {
				receiptCount: receipts.length,
				reimbursementCurrency: report.reimbursementCurrency,
				receiptException: receiptExceptionContext(
					row.receiptExceptionReason ?? null,
					input.receiptExceptionsAllowed === true,
				),
				conversion: conversionOf(row.id),
			});
			const exception = frozenReceiptException(row.receiptExceptionReason, receipts.length);
			const exceptionFact =
				schemaVersion >= RECEIPT_EXCEPTION_SCHEMA_VERSION && exception
					? { receiptException: exception }
					: {};
			const { expenseDate, category, description, amount, currency, paidBy } = draft;
			const conversionFacts = () =>
				submittedConversionFacts({
					schemaVersion,
					enforce,
					original: { amount, currency },
					reimbursementCurrency: report.reimbursementCurrency,
					conversion: conversionOf(row.id),
					receiptIds: receipts.map((receipt) => receipt.receiptId),
				});
			const project = projectFacts(input, row, mode, schemaVersion, frozen);
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
					...conversionFacts(),
					...project,
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
				...conversionFacts(),
				...project,
			};
		});
	const trip = enforce ? tripFacts(report, items.length) : liveTripFacts(report);
	const totals = receiptReportTotals(
		items.map((item) => ({
			amount: item.original.amount,
			currency: item.original.currency,
			paidBy: item.paidBy,
			conversion: conversionOf(item.itemId),
			// A per diem counts its calculated allowance, zero included (#609).
			...(item.type === "per_diem" ? { type: item.type, perDiem: { ...item.original } } : {}),
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
		...adjustmentSnapshot({
			link: input.adjustment,
			baseline: input.adjustmentBaseline,
			frozen: frozen?.adjustment,
			corrected: { amount: totals.reimbursable, currency: totals.currency },
			mode,
			schemaVersion,
		}),
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
		// Only adjustment reports have one (v8, #615); other fingerprints stay unchanged.
		...(facts.adjustment ? [["adjustment", facts.adjustment]] : []),
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
		liveFacts = snapshotReport(live, "compare", schemaVersion, submitted);
	} catch (error) {
		if (!(error instanceof ApprovalEvidenceError)) throw error;
		return {
			kind: "material_change",
			changedFields: [`unverifiable:${error.details.field ?? error.code}`],
		};
	}
	const changedFields: string[] = MATERIAL_FIELDS.filter(
		(field) => canonicalJson(submitted[field]) !== canonicalJson(liveFacts[field]),
	);
	if (
		(submitted.adjustment || liveFacts.adjustment) &&
		canonicalJson(submitted.adjustment ?? null) !== canonicalJson(liveFacts.adjustment ?? null)
	) {
		changedFields.push("adjustment");
	}
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
