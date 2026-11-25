import type { ContractorPricing } from "@/lib/contractor-compensation/pricing";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";

/**
 * Contractor cost for Billable Time margin (#1999, spec #1935). Pure and
 * client-safe: the report reader prices the contractors' work with the
 * contractor pricing engine (`contractor-compensation/pricing.ts`) and passes
 * the result here; `costWorkPeriod` falls back to it on days without an
 * explicit cost rate.
 *
 * The engine prices each (contractor, engagement, local day) once from all of
 * that day's completed work, whatever the project and billable or not, and
 * allocates the day's amount to the day's work shares by duration (largest
 * remainder). A work period's cost on a day is the sum of its allocations, so a
 * daily fee spread over several projects adds up to exactly one fee.
 *
 * A day's cost is known only when all of the work's time on that day is priced
 * in the billable currency: terms in another currency are never converted or
 * mixed in, and a day without terms stays unknown, never zero.
 */

interface DayCost {
	/** The allocated amounts in cents of the billable currency. */
	amountCents: bigint;
	/** Elapsed time of the priced shares, to tell whether they cover the work's day. */
	pricedNs: bigint;
	/** Part of the day is unpriced or priced in another currency. */
	unknown: boolean;
}

/** The engine's allocations per work period and contractor-local day. */
export interface ContractorCosts {
	readonly byWorkDay: ReadonlyMap<string, DayCost>;
}

export const NO_CONTRACTOR_COSTS: ContractorCosts = { byWorkDay: new Map() };

function key(workId: string, date: PlainDate): string {
	return `${workId}|${date.toString()}`;
}

/**
 * Indexes the engine's priced days by work period and day. Every billable
 * currency has two minor-unit digits (`money.ts`), so a day amount in the
 * billable currency is already in cents.
 */
export function contractorCostsFrom(
	pricing: Pick<ContractorPricing, "days">,
	billableCurrency: string,
): ContractorCosts {
	const byWorkDay = new Map<string, DayCost>();
	for (const entry of pricing.days) {
		const priced =
			entry.pricing.kind === "priced" && entry.pricing.compensation.currency === billableCurrency
				? entry.pricing
				: null;
		// The engine allocates the day's amount share by share, in the shares' order.
		entry.shares.forEach((share, index) => {
			const id = key(share.workId, entry.date);
			const current = byWorkDay.get(id) ?? {
				amountCents: BigInt(0),
				pricedNs: BigInt(0),
				unknown: false,
			};
			const allocation = priced?.allocations[index];
			if (!allocation || allocation.workId !== share.workId) {
				current.unknown = true;
			} else {
				current.pricedNs += share.end.epochNanoseconds - share.start.epochNanoseconds;
				current.amountCents += allocation.amountMinor;
			}
			byWorkDay.set(id, current);
		});
	}
	return { byWorkDay };
}

/** Whether the engine priced any of the work's time on `date`. */
export function hasContractorCost(
	costs: ContractorCosts,
	workId: string,
	date: PlainDate,
): boolean {
	return costs.byWorkDay.has(key(workId, date));
}

/**
 * The contractor cost of the part `[start, end)` of a work period that lies on
 * its local day `date`, in cents; null when that part is not entirely priced
 * in the billable currency.
 */
export function contractorCostOf(
	costs: ContractorCosts,
	input: { workId: string; date: PlainDate; start: Instant; end: Instant },
): bigint | null {
	const cost = costs.byWorkDay.get(key(input.workId, input.date));
	if (!cost || cost.unknown) return null;
	const elapsed = input.end.epochNanoseconds - input.start.epochNanoseconds;
	return cost.pricedNs === elapsed ? cost.amountCents : null;
}
