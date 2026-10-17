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

/** A stored billing interval as a seat price interval: anything but "year" bills monthly. */
export function seatInterval(billingInterval: string | null): "month" | "year" {
	return billingInterval === "year" ? "year" : "month";
}

/** One seat type's prices in euros: monthly, monthly when billed yearly, and the yearly total. */
export function seatPriceEuros(type: SeatType): {
	monthly: number;
	yearlyPerMonth: number;
	yearlyTotal: number;
} {
	const prices = SEAT_PRICES_CENTS[type];
	return {
		monthly: prices.month / 100,
		yearlyPerMonth: prices.yearPerMonth / 100,
		yearlyTotal: (prices.yearPerMonth * 12) / 100,
	};
}

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

/**
 * Euro cents as a display amount: whole euros without decimals ("2", "18"),
 * anything else with two ("1.50"), never "1.5". Format before passing to a
 * translation placeholder.
 */
export function formatEuroAmount(cents: number, locale = "en"): string {
	const fractionDigits = cents % 100 === 0 ? 0 : 2;
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	}).format(cents / 100);
}

/** A stored subscription's seat counts: `currentSeats` is the total, `currentKioskSeats` the kiosk part. */
export type SubscriptionSeats = {
	billingInterval: string | null;
	currentSeats: number;
	currentKioskSeats: number;
};

/**
 * Monthly recurring revenue of subscriptions, in cents: each subscription's
 * full seats and kiosk seats at its interval's prices. Any interval other than
 * "year" bills monthly. Rows written while kiosk seats are off have no kiosk
 * seats, so every seat prices as a full seat.
 */
export function monthlyRecurringRevenueCents(subscriptions: readonly SubscriptionSeats[]): number {
	return subscriptions.reduce((sum, subscription) => {
		const kioskSeats = subscription.currentKioskSeats;
		return (
			sum +
			seatCost({
				interval: seatInterval(subscription.billingInterval),
				fullSeats: subscription.currentSeats - kioskSeats,
				kioskSeats,
			}).totalPerMonthCents
		);
	}, 0);
}
