/**
 * Amount differences of work changed after invoicing (#1502): what a
 * correction changes in the amount the work was handed off with, priced only
 * at the rate frozen in its shares at hand-off. Pure and client-safe; it never
 * reads current billable rates, so a backdated rate edit changes nothing.
 *
 * - The work still billable on the handed-off project and the draft's customer
 *   is priced as (its hours − the handed-off hours) × the one frozen rate. The
 *   draft line was rounded on its own, so this may be a few cents off it.
 *   Hand-offs priced across several rates can't be repeated without today's
 *   rates: unknown, unless the times and hours are unchanged.
 * - Nothing of it is left (removed, non-billable, or its project now belongs to
 *   another customer or none): the whole handed-off amount reverses, the sum
 *   of the shares' frozen amounts. A share without one (older rows) stands in
 *   with rate × duration, so the difference is estimated.
 * - Work on another project of the same customer has no frozen rate: unknown.
 *
 * Amounts are accrued exactly (rate cents × milliseconds, `money.ts`) and
 * rounded once per shown difference, so the difference since a resolution is
 * not the difference of two rounded amounts.
 */

import {
	compareInstants,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { type AccruedAmount, formatRate, rateFromStored, roundAccruedAmount } from "../money";
import type { ComparedPiece } from "./comparison";
import type {
	AmountDifferenceView,
	ItemAmountDifferenceView,
	PricedDifferenceReason,
	UnknownDifferenceReason,
} from "./views";

/** A frozen share of the handed-off row (`InvoicedWorkShare`). */
export interface FrozenShare {
	durationMs: number;
	/** The frozen hourly rate, two decimals. */
	rate: string;
	/** Its part of the line's frozen amount; absent on older rows. */
	amount?: string;
}

/** The span work covers and its recorded minutes. */
interface WorkTimes {
	startedAt: string;
	endedAt: string;
	durationMinutes: number;
}

/** What the hand-off froze for a comparison item. */
export interface FrozenPricing extends WorkTimes {
	/** The handed-off row's shares; pieces split off later have none. */
	shares: readonly FrozenShare[];
	projectId: string;
	/** The draft's customer. */
	customerId: string;
	/** The draft's currency. */
	currency: string;
}

export interface AmountDifferenceInput {
	frozen: FrozenPricing;
	/** The latest resolution's snapshot pieces; null when never resolved. */
	lastResolved: readonly ComparedPiece[] | null;
	/** The live work periods of the item. */
	current: readonly ComparedPiece[];
}

type Accrued =
	| {
			priced: true;
			/** Exact, against the hand-off. */
			amount: AccruedAmount;
			estimated: boolean;
			reason: PricedDifferenceReason;
			roundingCaveat: boolean;
	  }
	| {
			priced: false;
			reason: UnknownDifferenceReason;
			/** The times priced across several rates: the same times have the same amount. */
			times?: WorkTimes;
	  };

const MS_PER_MINUTE = BigInt(60_000);
const MS_PER_HOUR = BigInt(3_600_000);

const NO_DIFFERENCE: Accrued = {
	priced: true,
	amount: BigInt(0),
	estimated: false,
	reason: "frozen_rate",
	roundingCaveat: false,
};

/** The span of ended pieces and their minutes. */
function timesOf(pieces: readonly (ComparedPiece & { endedAt: string })[]): WorkTimes {
	const starts = pieces.map((piece) => parseInstant(piece.startedAt)).sort(compareInstants);
	const ends = pieces.map((piece) => parseInstant(piece.endedAt)).sort(compareInstants);
	return {
		startedAt: instantToCanonicalString(starts[0]),
		endedAt: instantToCanonicalString(ends[ends.length - 1]),
		durationMinutes: pieces.reduce((sum, piece) => sum + (piece.durationMinutes ?? 0), 0),
	};
}

function sameTimes(a: WorkTimes, b: WorkTimes): boolean {
	return (
		a.durationMinutes === b.durationMinutes &&
		parseInstant(a.startedAt).equals(parseInstant(b.startedAt)) &&
		parseInstant(a.endedAt).equals(parseInstant(b.endedAt))
	);
}

/** The work that still belongs on the draft: billable for the draft's customer. */
function stillInvoiced(frozen: FrozenPricing, pieces: readonly ComparedPiece[]) {
	return pieces.filter(
		(piece) => !piece.removed && piece.billable && piece.customerId === frozen.customerId,
	);
}

function reversal(frozen: FrozenPricing, pieces: readonly ComparedPiece[]): Accrued {
	const live = pieces.filter((piece) => !piece.removed);
	const reason: PricedDifferenceReason =
		live.length === 0
			? "removed"
			: live.some((piece) => piece.billable)
				? "customer"
				: "non_billable";
	let amount: AccruedAmount = BigInt(0);
	let estimated = false;
	for (const share of frozen.shares) {
		if (share.amount === undefined) {
			estimated = true;
			amount += rateFromStored(share.rate) * BigInt(share.durationMs);
		} else {
			amount += rateFromStored(share.amount) * MS_PER_HOUR;
		}
	}
	return { priced: true, amount: -amount, estimated, reason, roundingCaveat: false };
}

/** The pieces' difference from the hand-off, exact. */
function accrue(frozen: FrozenPricing, pieces: readonly ComparedPiece[]): Accrued {
	if (frozen.shares.length === 0) return { priced: false, reason: "no_frozen_rate" };
	const kept = stillInvoiced(frozen, pieces);
	if (kept.length === 0) return reversal(frozen, pieces);
	const ended = kept.filter(
		(piece): piece is ComparedPiece & { endedAt: string } =>
			piece.endedAt !== null && piece.durationMinutes !== null,
	);
	if (ended.length < kept.length) return { priced: false, reason: "running" };
	if (kept.some((piece) => piece.projectId !== frozen.projectId)) {
		return { priced: false, reason: "other_project" };
	}
	const times = timesOf(ended);
	const rates = new Set(frozen.shares.map((share) => rateFromStored(share.rate)));
	// Moved times fall differently into the rates, even with the same hours.
	if (rates.size > 1) {
		return sameTimes(times, frozen)
			? NO_DIFFERENCE
			: { priced: false, reason: "several_rates", times };
	}
	const changedMinutes = times.durationMinutes - frozen.durationMinutes;
	if (changedMinutes === 0) return NO_DIFFERENCE;
	const [rate] = rates;
	return {
		priced: true,
		amount: rate * BigInt(changedMinutes) * MS_PER_MINUTE,
		estimated: false,
		reason: "frozen_rate",
		roundingCaveat: true,
	};
}

/** `current` against `previous`, both against the same hand-off. */
function since(current: Accrued, previous: Accrued): Accrued {
	if (!current.priced && current.times && !previous.priced && previous.times) {
		return sameTimes(current.times, previous.times) ? NO_DIFFERENCE : current;
	}
	if (!current.priced) return current;
	if (!previous.priced) return previous;
	const bothReversed = current.reason !== "frozen_rate" && previous.reason !== "frozen_rate";
	return {
		priced: true,
		amount: current.amount - previous.amount,
		// Two reversals of the same estimate cancel out exactly.
		estimated: !bothReversed && (current.estimated || previous.estimated),
		reason: current.reason,
		roundingCaveat: current.roundingCaveat || previous.roundingCaveat,
	};
}

function view(accrued: Accrued): AmountDifferenceView {
	if (!accrued.priced) return { kind: "unknown", reason: accrued.reason };
	return {
		kind: accrued.estimated ? "estimated" : "known",
		amount: formatRate(roundAccruedAmount(accrued.amount)),
		reason: accrued.reason,
		roundingCaveat: accrued.roundingCaveat,
	};
}

/** The item's amount difference from the hand-off and since its latest resolution. */
export function amountDifferenceOf(input: AmountDifferenceInput): ItemAmountDifferenceView {
	const { frozen } = input;
	const current = accrue(frozen, input.current);
	return {
		currency: frozen.currency,
		fromHandOff: view(current),
		sinceResolution: input.lastResolved
			? view(since(current, accrue(frozen, input.lastResolved)))
			: null,
		notOnHandOffForNewCustomer: input.current.some(
			(piece) =>
				!piece.removed &&
				piece.billable &&
				piece.customerId !== null &&
				piece.customerId !== frozen.customerId,
		),
	};
}

/**
 * The difference still open: since the latest resolution when there is one,
 * otherwise from the hand-off. Subtotals add these.
 */
export function openAmountDifference(difference: ItemAmountDifferenceView): AmountDifferenceView {
	return difference.sinceResolution ?? difference.fromHandOff;
}
