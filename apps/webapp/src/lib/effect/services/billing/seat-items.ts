import type Stripe from "stripe";
import type { SeatsByType } from "./billable-seat-count";
import type { StripeConfig } from "./stripe.service";

/** The configured prices a full seat is billed at. */
export type FullSeatPrices = Pick<StripeConfig, "priceMonthlyId" | "priceYearlyId">;

/** Whether `priceId` is a configured full seat price (monthly or yearly). */
export const isFullSeatPrice = (prices: FullSeatPrices, priceId: string | undefined): boolean =>
	!!priceId && (priceId === prices.priceMonthlyId || priceId === prices.priceYearlyId);

/**
 * The subscription's full seat item: the item billed at a configured full seat
 * price, wherever it sits in the item list. Items at any other price are not
 * seats. Undefined when the subscription has no full seat item.
 */
export const findFullSeatItem = (
	subscription: Pick<Stripe.Subscription, "items">,
	prices: FullSeatPrices,
): Stripe.SubscriptionItem | undefined =>
	subscription.items.data.find((item) => isFullSeatPrice(prices, item.price?.id));

/** The configured prices a kiosk seat is billed at (#886). */
export type KioskSeatPrices = Pick<StripeConfig, "priceKioskMonthlyId" | "priceKioskYearlyId">;

/**
 * Whether kiosk seats are on: only when both kiosk seat prices are configured.
 * While off, every billable seat is a full seat and billing behaves as before #886.
 */
export const kioskSeatsEnabled = (prices: KioskSeatPrices): boolean =>
	!!prices.priceKioskMonthlyId && !!prices.priceKioskYearlyId;

/** Whether `priceId` is a configured kiosk seat price. Never true while kiosk seats are off. */
export const isKioskSeatPrice = (prices: KioskSeatPrices, priceId: string | undefined): boolean =>
	kioskSeatsEnabled(prices) &&
	!!priceId &&
	(priceId === prices.priceKioskMonthlyId || priceId === prices.priceKioskYearlyId);

/**
 * The subscription's kiosk seat item: the item billed at a configured kiosk
 * seat price, wherever it sits. Undefined when it has none or kiosk seats are off.
 */
export const findKioskSeatItem = (
	subscription: Pick<Stripe.Subscription, "items">,
	prices: KioskSeatPrices,
): Stripe.SubscriptionItem | undefined =>
	subscription.items.data.find((item) => isKioskSeatPrice(prices, item.price?.id));

/**
 * The kiosk seat price for the full seat item's interval: every item on a
 * subscription shares one interval, so a yearly full seat means a yearly kiosk seat.
 */
export const kioskSeatPriceFor = (
	prices: FullSeatPrices & KioskSeatPrices,
	fullSeatItem: Pick<Stripe.SubscriptionItem, "price">,
): string =>
	(fullSeatItem.price?.id === prices.priceYearlyId
		? prices.priceKioskYearlyId
		: prices.priceKioskMonthlyId) ?? "";

/** One seat line item on a new subscription: the price and how many seats it bills. */
export type CheckoutSeatLine = { priceId: string; quantity: number };

/**
 * The seat line items checkout sends for `interval`: the full seat line (at least
 * one seat, an empty full price when it is not configured) and, only while kiosk
 * seats are on and the organization has some, the kiosk seat line at the kiosk
 * price for the same interval. Without kiosk seats, seat sync adds the kiosk item
 * later, the first time a kiosk seat appears.
 */
export const checkoutSeatLines = (
	prices: FullSeatPrices & KioskSeatPrices,
	interval: "month" | "year",
	seats: SeatsByType,
): { full: CheckoutSeatLine; kiosk?: CheckoutSeatLine } => {
	const full = {
		priceId: interval === "year" ? prices.priceYearlyId : prices.priceMonthlyId,
		quantity: Math.max(seats.full, 1),
	};
	if (!kioskSeatsEnabled(prices) || seats.kiosk <= 0) return { full };
	const kioskPriceId =
		(interval === "year" ? prices.priceKioskYearlyId : prices.priceKioskMonthlyId) ?? "";
	return { full, kiosk: { priceId: kioskPriceId, quantity: seats.kiosk } };
};
