import type { Instant } from "@/lib/datetime/temporal-core";
import { divideToUnits, formatUnits, parseUnits } from "@/lib/money/exact-decimal";
import { type BillableRatePeriod, priceWorkPeriod } from "./applicable-rate";
import { type CostRatePeriod, costWorkPeriod } from "./cost-rate";
import {
	type AccruedAmount,
	formatRate,
	RATE_SCALE,
	roundAccruedAmount,
	ZERO_ACCRUED,
} from "./money";

/**
 * Billable hours, revenue and margin figures for reports (#902). Pure and
 * client-safe: the report reader loads the work and the rate periods, this
 * module prices, costs and adds them up.
 *
 * Rounding rule (the Billable Time money rule, `money.ts`):
 * - Revenue and cost are accrued exactly (rate cents × milliseconds) per work
 *   period share and summed exactly over one figure set, such as a project or
 *   one employee on a project. That set's revenue and cost are each rounded
 *   once, half up, to the cent.
 * - Margin is the set's rounded revenue minus its rounded cost, so the three
 *   amounts shown side by side always add up.
 * - Roll-ups (a customer, the portfolio) are sums of their projects' rounded
 *   amounts (`sumBillableFigures`), never rounded again, so a customer's totals
 *   always equal the sum of its projects.
 *
 * Visibility is decided by the caller and applied here, at the data layer:
 * `"revenue"` figures (project managers) have no cost or margin field at all,
 * so nothing built from them, exports included, can show one.
 */

/** One completed, non-deleted work period as a report counts it. */
export interface ReportedWork {
	id: string;
	employeeId: string;
	projectId: string;
	/** The project's current customer; billable work needs one. */
	customerId: string | null;
	startedAt: Instant;
	endedAt: Instant;
	/** The UTC offset captured on the work's start entry. */
	startOffsetMinutes: number;
	/** The recorded duration, net of breaks. */
	durationMinutes: number;
	isBillable: boolean;
	/** A correction or submission for the work is still unresolved. */
	pendingReview: boolean;
}

/** Who sees which figures: project managers see revenue, owners and admins everything. */
export type BillableFiguresAccess = "revenue" | "full";

interface BillableFiguresBase {
	/** The billable currency the amounts are in. */
	currency: string;
	billableMinutes: number;
	billableHours: number;
	nonBillableMinutes: number;
	nonBillableHours: number;
	/** Billable work with time that no rate level prices. */
	unpricedWorkCount: number;
	/** The unpriced share of that work, in hours. */
	unpricedHours: number;
	/** Counted work (billable or not) with a pending correction or submission. */
	pendingReviewCount: number;
	/** Two-decimal amount in `currency`. */
	revenue: string;
}

/** Figures for a project manager: hours and revenue, never cost or margin. */
export interface BillableRevenueFigures extends BillableFiguresBase {
	access: "revenue";
}

/** Figures for owners and admins. */
export interface BillableMarginFigures extends BillableFiguresBase {
	access: "full";
	/** Null ("cost unknown") while any of the billable work has no cost rate. */
	cost: string | null;
	/** Revenue minus cost; null ("cost unknown") whenever cost is. */
	margin: string | null;
	/** Margin as a share of revenue, one decimal; null when unknown or without revenue. */
	marginPercent: string | null;
	/** Billable work with time that has no cost rate. */
	costUnknownWorkCount: number;
}

export type BillableFigures = BillableRevenueFigures | BillableMarginFigures;

export interface BillableFiguresOptions {
	access: BillableFiguresAccess;
	currency: string;
}

/** Exact running sums for one figure set, before rounding. */
export interface BillableFiguresTally {
	billableMinutes: number;
	nonBillableMinutes: number;
	unpricedWorkCount: number;
	unpricedMs: number;
	pendingReviewCount: number;
	revenue: AccruedAmount;
	cost: AccruedAmount;
	costUnknownWorkCount: number;
}

export interface ReportRates {
	billable: readonly BillableRatePeriod[];
	cost: readonly CostRatePeriod[];
}

export function emptyBillableFiguresTally(): BillableFiguresTally {
	return {
		billableMinutes: 0,
		nonBillableMinutes: 0,
		unpricedWorkCount: 0,
		unpricedMs: 0,
		pendingReviewCount: 0,
		revenue: ZERO_ACCRUED,
		cost: ZERO_ACCRUED,
		costUnknownWorkCount: 0,
	};
}

/**
 * Billable work as the glossary defines it: marked billable and on a project
 * that has a customer. Work marked billable on a project that has since lost
 * its customer is not chargeable to anyone and counts as non-billable.
 */
export function isChargeableWork(work: Pick<ReportedWork, "isBillable" | "customerId">): boolean {
	return work.isBillable && work.customerId !== null;
}

/** Adds one piece of work to a tally (mutates and returns it). */
export function addReportedWork(
	tally: BillableFiguresTally,
	work: ReportedWork,
	rates: ReportRates,
): BillableFiguresTally {
	if (work.pendingReview) tally.pendingReviewCount += 1;
	if (!isChargeableWork(work)) {
		tally.nonBillableMinutes += work.durationMinutes;
		return tally;
	}
	tally.billableMinutes += work.durationMinutes;
	const priced = priceWorkPeriod(work, rates.billable);
	tally.revenue += priced.accrued;
	if (priced.unpricedMs > 0) {
		tally.unpricedWorkCount += 1;
		tally.unpricedMs += priced.unpricedMs;
	}
	const cost = costWorkPeriod(work, rates.cost);
	tally.cost += cost.accrued;
	if (cost.unknownMs > 0) tally.costUnknownWorkCount += 1;
	return tally;
}

export function tallyReportedWork(
	work: Iterable<ReportedWork>,
	rates: ReportRates,
): BillableFiguresTally {
	const tally = emptyBillableFiguresTally();
	for (const item of work) addReportedWork(tally, item, rates);
	return tally;
}

const MS_PER_HOUR = 3_600_000;

function marginPercentOf(marginCents: bigint, revenueCents: bigint): string | null {
	if (revenueCents === BigInt(0)) return null;
	return formatUnits(
		divideToUnits(
			{ units: marginCents * BigInt(100), scale: 0 },
			{ units: revenueCents, scale: 0 },
			1,
			"half_up",
		),
		1,
	);
}

interface RoundedFigures {
	billableMinutes: number;
	nonBillableMinutes: number;
	unpricedWorkCount: number;
	unpricedHours: number;
	pendingReviewCount: number;
	revenueCents: bigint;
	/** Null while any of the work has no cost rate. */
	costCents: bigint | null;
	costUnknownWorkCount: number;
}

function figuresFromRounded(
	rounded: RoundedFigures,
	options: BillableFiguresOptions,
): BillableFigures {
	const base: BillableFiguresBase = {
		currency: options.currency,
		billableMinutes: rounded.billableMinutes,
		billableHours: rounded.billableMinutes / 60,
		nonBillableMinutes: rounded.nonBillableMinutes,
		nonBillableHours: rounded.nonBillableMinutes / 60,
		unpricedWorkCount: rounded.unpricedWorkCount,
		unpricedHours: rounded.unpricedHours,
		pendingReviewCount: rounded.pendingReviewCount,
		revenue: formatRate(rounded.revenueCents),
	};
	if (options.access === "revenue") return { access: "revenue", ...base };
	const marginCents = rounded.costCents === null ? null : rounded.revenueCents - rounded.costCents;
	return {
		access: "full",
		...base,
		cost: rounded.costCents === null ? null : formatRate(rounded.costCents),
		margin: marginCents === null ? null : formatRate(marginCents),
		marginPercent: marginCents === null ? null : marginPercentOf(marginCents, rounded.revenueCents),
		costUnknownWorkCount: rounded.costUnknownWorkCount,
	};
}

/** One figure set's figures: revenue and cost rounded once, half up. */
export function billableFigures(
	tally: BillableFiguresTally,
	options: BillableFiguresOptions,
): BillableFigures {
	return figuresFromRounded(
		{
			billableMinutes: tally.billableMinutes,
			nonBillableMinutes: tally.nonBillableMinutes,
			unpricedWorkCount: tally.unpricedWorkCount,
			unpricedHours: tally.unpricedMs / MS_PER_HOUR,
			pendingReviewCount: tally.pendingReviewCount,
			revenueCents: roundAccruedAmount(tally.revenue),
			costCents: tally.costUnknownWorkCount > 0 ? null : roundAccruedAmount(tally.cost),
			costUnknownWorkCount: tally.costUnknownWorkCount,
		},
		options,
	);
}

function centsOf(amount: string): bigint {
	const units = parseUnits(amount, RATE_SCALE);
	if (units === null) throw new RangeError(`Not a figure amount: ${amount}`);
	return units;
}

/**
 * The roll-up of several figure sets (a customer's projects, a portfolio): the
 * sum of their shown figures. Cost and margin are unknown when any part's are,
 * and are left out entirely for `"revenue"` access.
 */
export function sumBillableFigures(
	parts: readonly BillableFigures[],
	options: BillableFiguresOptions,
): BillableFigures {
	let costCents: bigint | null = BigInt(0);
	let costUnknownWorkCount = 0;
	for (const part of parts) {
		if (part.access !== "full") {
			costCents = null;
			continue;
		}
		costUnknownWorkCount += part.costUnknownWorkCount;
		costCents = costCents === null || part.cost === null ? null : costCents + centsOf(part.cost);
	}
	return figuresFromRounded(
		{
			billableMinutes: parts.reduce((sum, part) => sum + part.billableMinutes, 0),
			nonBillableMinutes: parts.reduce((sum, part) => sum + part.nonBillableMinutes, 0),
			unpricedWorkCount: parts.reduce((sum, part) => sum + part.unpricedWorkCount, 0),
			unpricedHours: parts.reduce((sum, part) => sum + part.unpricedHours, 0),
			pendingReviewCount: parts.reduce((sum, part) => sum + part.pendingReviewCount, 0),
			revenueCents: parts.reduce((sum, part) => sum + centsOf(part.revenue), BigInt(0)),
			costCents,
			costUnknownWorkCount,
		},
		options,
	);
}
