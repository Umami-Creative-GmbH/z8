import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
	TravelExpenseReportSubmittedMileage,
} from "@/lib/approvals/evidence/travel-expense-report-facts";
import type { TravelExpenseReportSubmittedPerDiem } from "@/lib/approvals/evidence/travel-expense-report-per-diem";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { calculateMileage } from "./mileage";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE } from "./money";
import { PAYROLL_LINE_KINDS, type PayrollLineKind } from "./payroll-line-kind";
import { calculatePerDiem, DOMESTIC_PER_DIEM_AREA, type PerDiemPolicyResolver } from "./per-diem";
import type { SettlementEntryKind } from "./settlement.types";
import { GERMAN_MILEAGE_DEFAULT } from "./statutory-allowance-defaults";
import { foreignPerDiemTableCovering, foreignTableRates } from "./statutory-foreign-per-diem";
import { GERMAN_DOMESTIC_PER_DIEM_DEFAULT, type PerDiemRates } from "./statutory-per-diem-defaults";

/**
 * The payroll lines of one approved expense report (#850, ADR 0004): what a
 * payroll run carries for it, per payroll line kind, or why a payroll run
 * cannot carry it and it is reimbursed by bank transfer instead. Pure: callers
 * load the inputs.
 *
 * Each per diem and mileage item is split into its statutory share and its
 * taxable excess. The statutory share is the item recomputed from its frozen
 * facts with the existing calculators, priced at the verified statutory
 * amounts of each day (domestic § 9 Abs. 4a EStG, abroad the BMF table
 * covering the day) or the statutory rate of the vehicle, and never more than
 * the item's amount; the excess is the rest, so both always add up to it.
 * Receipts go to their category's line. Earlier payroll runs' lines are
 * subtracted per kind: reimbursements carry no wage-type breakdown, so a kind
 * that would go below zero cannot be corrected through payroll.
 */

export { PAYROLL_LINE_KINDS, type PayrollLineKind } from "./payroll-line-kind";

/** Payroll runs carry euro amounts only; nothing is converted. */
const PAYROLL_CURRENCY = "EUR";

/** One amount a payroll run carries for a report, in euros at two decimals. */
export interface PayrollLine {
	kind: PayrollLineKind;
	amount: string;
	currency: typeof PAYROLL_CURRENCY;
}

export type PayrollRevision = Pick<
	TravelExpenseReportSubmittedFacts,
	"reimbursementCurrency" | "trip" | "items"
>;

export type PayrollLinesInput =
	| {
			source: "report";
			/**
			 * The report's latest approved revision: the original's, or the latest
			 * approved adjustment's (which holds the whole corrected report).
			 */
			revision: PayrollRevision;
			/** The settlement account's entries; `payrollRunId` names the confirmed run that recorded one. */
			settlementEntries: readonly { kind: SettlementEntryKind; payrollRunId: string | null }[];
			/** Every line earlier payroll runs carried for this report. */
			priorLines: readonly PayrollLine[];
	  }
	/** An approved legacy claim has no frozen items to split. */
	| { source: "legacy_claim" };

/** Why an allowance item has no statutory share to split at. */
export type NoStatutoryBaselineCause =
	/** An expense administrator set the amount by hand (#610). */
	| "allowance_override"
	/** The statutory rules do not cover the frozen itinerary. */
	| "exceptional_itinerary"
	/** A day or drive no verified statutory table or rule edition covers. */
	| "outside_verified_tables";

export interface PayrollExclusionItem {
	itemId: string;
	cause: NoStatutoryBaselineCause;
}

export type PayrollLinesResult =
	| { ok: true; lines: PayrollLine[] }
	| { ok: false; reason: "no_statutory_baseline"; items: PayrollExclusionItem[] }
	| { ok: false; reason: "negative_difference"; kinds: PayrollLineKind[] }
	| {
			ok: false;
			reason: "legacy_claim" | "currency_not_eur" | "reimbursed_outside_payroll" | "nothing_owed";
	  };

export type PayrollExclusionReason = Extract<PayrollLinesResult, { ok: false }>["reason"];

const ZERO = BigInt(0);

function storedUnits(value: string): bigint {
	const parsed = parseUnits(value, STORED_AMOUNT_SCALE);
	if (parsed === null) throw new RangeError(`Not a stored amount: ${value}`);
	return parsed;
}

/**
 * What a receipt counts with in the reimbursement currency: as paid, or the
 * frozen conversion's result (never converted again, unlike the live totals of
 * `item-amount.ts`). A frozen employee-paid receipt always has one.
 */
function receiptAmount(item: TravelExpenseReportSubmittedItem, currency: string): string {
	if (item.original.currency === currency && item.original.amount) return item.original.amount;
	const converted = item.conversion?.reimbursement;
	if (converted?.currency !== currency) {
		throw new RangeError(`Receipt ${item.itemId} has no amount in ${currency}`);
	}
	return converted.amount;
}

/**
 * Prices a per diem day at the statutory amounts: the domestic amounts of
 * § 9 Abs. 4a EStG, and abroad the verified BMF table covering that day. A
 * day no verified amount covers has no version.
 */
const statutoryPerDiemResolver: PerDiemPolicyResolver = (date, area = DOMESTIC_PER_DIEM_AREA) => {
	let source: { key: string; validFrom: string; rates: PerDiemRates | undefined };
	if (area === DOMESTIC_PER_DIEM_AREA) {
		const domestic = GERMAN_DOMESTIC_PER_DIEM_DEFAULT;
		if (comparePlainDates(parsePlainDate(date), parsePlainDate(domestic.validFrom)) < 0) {
			return { status: "no_version" };
		}
		source = domestic;
	} else {
		const table = foreignPerDiemTableCovering([date]);
		if (!table) return { status: "no_version" };
		source = { key: table.key, validFrom: table.validFrom, rates: foreignTableRates(table)[area] };
	}
	const { key, validFrom, rates } = source;
	if (!rates) return { status: "no_version" };
	return {
		status: "found",
		policy: {
			policyId: "statutory",
			versionId: key,
			effectiveFrom: validFrom,
			currency: PAYROLL_CURRENCY,
			source: { kind: "statutory_default", reference: null, version: null, defaultKey: key },
			area,
			rates: { ...rates },
		},
	};
};

type StatutoryAmount = { amount: string } | { cause: NoStatutoryBaselineCause };

/**
 * The per diem recomputed from its frozen itinerary, meals, daily locations
 * and claimed days, priced at the statutory amounts of each day. A frozen
 * per diem was calculated, so it was no longer workplace stay. The rule
 * edition and foreign table are those covering the trip's days, not the
 * stamped ones: the statutory share follows the verified statutory sources.
 */
function statutoryPerDiemAmount(
	frozen: TravelExpenseReportSubmittedPerDiem,
	revision: PayrollRevision,
): StatutoryAmount {
	const calculation = calculatePerDiem(
		{
			startDate: frozen.start.date,
			startTime: frozen.start.time,
			startTimeZone: frozen.start.timeZone,
			endDate: frozen.end.date,
			endTime: frozen.end.time,
			endTimeZone: frozen.end.timeZone,
			overnight: frozen.overnight,
			prolongedWorkplace: false,
			meals: frozen.meals,
		},
		{
			trip: { destinations: revision.trip?.destinations ?? [] },
			reimbursementCurrency: PAYROLL_CURRENCY,
			resolvePolicy: statutoryPerDiemResolver,
			// Days another report already paid stay unpaid here too.
			overlappingDays: frozen.days
				.filter((day) => day.basis === "claimed_in_other_report")
				.map((day) => day.date),
		},
	);
	if (calculation.status === "calculated") return { amount: calculation.amount };
	if (
		calculation.status === "policy_missing" ||
		(calculation.status === "exceptional" && calculation.reasons.includes("rules_not_verified"))
	) {
		return { cause: "outside_verified_tables" };
	}
	// Exceptional for any other reason (a frozen per diem is never incomplete or in another currency).
	return { cause: "exceptional_itinerary" };
}

/** distance × the statutory rate of the vehicle, from the first day those rates were verified. */
function statutoryMileageAmount(
	frozen: TravelExpenseReportSubmittedMileage,
	expenseDate: string,
): StatutoryAmount {
	const rates = GERMAN_MILEAGE_DEFAULT;
	if (comparePlainDates(parsePlainDate(expenseDate), parsePlainDate(rates.validFrom)) < 0) {
		return { cause: "outside_verified_tables" };
	}
	return calculateMileage({
		distanceKm: frozen.distanceKm,
		ratePerKm: rates.ratesPerKm[frozen.vehicle],
	});
}

/** Where an item goes: a receipt to its category's line, an allowance split at its statutory amount. */
type ItemPayroll =
	| { kind: PayrollLineKind }
	| {
			kinds: readonly [share: PayrollLineKind, excess: PayrollLineKind];
			statutory: StatutoryAmount;
	  };

function itemPayroll(
	item: TravelExpenseReportSubmittedItem,
	revision: PayrollRevision,
): ItemPayroll {
	if (item.type === "receipt") return { kind: `receipt_${item.category}` };
	const override = { cause: "allowance_override" } as const;
	if (item.type === "mileage") {
		const kinds = ["mileage_statutory", "mileage_excess"] as const;
		if (item.allowanceOverride) return { kinds, statutory: override };
		if (item.mileage) {
			return { kinds, statutory: statutoryMileageAmount(item.mileage, item.expenseDate) };
		}
	} else {
		const kinds = ["per_diem_statutory", "per_diem_excess"] as const;
		if (item.allowanceOverride) return { kinds, statutory: override };
		if (item.perDiem) return { kinds, statutory: statutoryPerDiemAmount(item.perDiem, revision) };
	}
	throw new RangeError(`Allowance item ${item.itemId} has neither facts nor an override`);
}

export function computePayrollLines(input: PayrollLinesInput): PayrollLinesResult {
	if (input.source === "legacy_claim") return { ok: false, reason: "legacy_claim" };
	if (input.revision.reimbursementCurrency !== PAYROLL_CURRENCY) {
		return { ok: false, reason: "currency_not_eur" };
	}
	// Reimbursements carry no wage-type breakdown: only a payroll run's own are traceable.
	if (input.settlementEntries.some((entry) => entry.kind === "recovery" || !entry.payrollRunId)) {
		return { ok: false, reason: "reimbursed_outside_payroll" };
	}
	const totals = new Map<PayrollLineKind, bigint>();
	const add = (kind: PayrollLineKind, amount: bigint) =>
		totals.set(kind, (totals.get(kind) ?? ZERO) + amount);
	const unsupported: PayrollExclusionItem[] = [];
	const { revision } = input;
	for (const item of revision.items) {
		// Company-paid items are owed to nobody.
		if (item.paidBy !== "employee") continue;
		const payroll = itemPayroll(item, revision);
		if ("kind" in payroll) {
			add(payroll.kind, storedUnits(receiptAmount(item, revision.reimbursementCurrency)));
			continue;
		}
		if ("cause" in payroll.statutory) {
			unsupported.push({ itemId: item.itemId, cause: payroll.statutory.cause });
			continue;
		}
		// The statutory share never exceeds what was paid; the rest is taxable excess.
		const paid = storedUnits(item.original.amount ?? "0.00");
		const statutory = storedUnits(payroll.statutory.amount);
		const share = statutory < paid ? statutory : paid;
		add(payroll.kinds[0], share);
		add(payroll.kinds[1], paid - share);
	}
	if (unsupported.length > 0) {
		return { ok: false, reason: "no_statutory_baseline", items: unsupported };
	}
	// What earlier payroll runs carried is owed no more, kind by kind.
	for (const prior of input.priorLines) add(prior.kind, -storedUnits(prior.amount));
	const negative = PAYROLL_LINE_KINDS.filter((kind) => (totals.get(kind) ?? ZERO) < ZERO);
	if (negative.length > 0) return { ok: false, reason: "negative_difference", kinds: negative };
	const lines = PAYROLL_LINE_KINDS.flatMap((kind): PayrollLine[] => {
		const amount = totals.get(kind) ?? ZERO;
		if (amount === ZERO) return [];
		return [{ kind, amount: formatUnits(amount, STORED_AMOUNT_SCALE), currency: PAYROLL_CURRENCY }];
	});
	if (lines.length === 0) return { ok: false, reason: "nothing_owed" };
	return { ok: true, lines };
}
