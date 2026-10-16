/**
 * Seat prices as billed by the configured Stripe prices (#886). Shared by
 * client and server displays, so this file has no server-only imports. Amounts
 * are euro cents so the yearly kiosk half euro never rounds.
 *
 * Full seat: €4 per month, or €3 per month billed yearly (€36 per year).
 * Kiosk seat (kiosk-only employee): €2 per month, or €1.50 per month billed yearly (€18 per year).
 */
export const SEAT_PRICES_CENTS = {
	full: { month: 400, yearPerMonth: 300 },
	kiosk: { month: 200, yearPerMonth: 150 },
} as const;

export type SeatType = keyof typeof SEAT_PRICES_CENTS;

export type SeatCostLine = {
	type: SeatType;
	seats: number;
	pricePerMonthCents: number;
	subtotalPerMonthCents: number;
};

export type SeatCost = {
	lines: SeatCostLine[];
	totalPerMonthCents: number;
	/** The yearly invoice total; null for monthly billing. */
	totalPerYearCents: number | null;
};

/** The monthly price of one seat of `type` at `interval`, in cents. */
export function seatPricePerMonthCents(type: SeatType, interval: "month" | "year"): number {
	return interval === "year" ? SEAT_PRICES_CENTS[type].yearPerMonth : SEAT_PRICES_CENTS[type].month;
}

/**
 * The cost of a subscription's seats, one line per seat type. `kioskSeats`
 * null means kiosk seats are off: only the full seat line exists.
 */
export function seatCost(input: {
	interval: "month" | "year";
	fullSeats: number;
	kioskSeats: number | null;
}): SeatCost {
	const line = (type: SeatType, seats: number): SeatCostLine => {
		const pricePerMonthCents = seatPricePerMonthCents(type, input.interval);
		return { type, seats, pricePerMonthCents, subtotalPerMonthCents: seats * pricePerMonthCents };
	};
	const lines = [line("full", input.fullSeats)];
	if (input.kioskSeats !== null) lines.push(line("kiosk", input.kioskSeats));
	const totalPerMonthCents = lines.reduce((sum, entry) => sum + entry.subtotalPerMonthCents, 0);
	return {
		lines,
		totalPerMonthCents,
		totalPerYearCents: input.interval === "year" ? totalPerMonthCents * 12 : null,
	};
}

/** Euro cents as a plain amount with two decimals ("1.50"), for translation placeholders. */
export function formatEuroCents(cents: number): string {
	return (cents / 100).toFixed(2);
}
