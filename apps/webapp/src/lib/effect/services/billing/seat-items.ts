import type Stripe from "stripe";
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
