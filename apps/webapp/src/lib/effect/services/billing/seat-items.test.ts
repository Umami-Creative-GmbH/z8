import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
	findKioskSeatItem,
	kioskSeatPriceFor,
	kioskSeatReconcileConfigured,
	kioskSeatsEnabled,
} from "./seat-items";

const prices = {
	priceMonthlyId: "price_full_month",
	priceYearlyId: "price_full_year",
	priceKioskMonthlyId: "price_kiosk_month",
	priceKioskYearlyId: "price_kiosk_year",
};

const item = (id: string, priceId: string, quantity = 1) =>
	({ id, quantity, price: { id: priceId } }) as Stripe.SubscriptionItem;
const subscriptionWith = (...items: Stripe.SubscriptionItem[]) => ({
	items: { data: items } as Stripe.ApiList<Stripe.SubscriptionItem>,
});

describe("kiosk seat items", () => {
	it.each([
		{ monthly: "price_kiosk_month", yearly: "price_kiosk_year", enabled: true },
		{ monthly: "price_kiosk_month", yearly: "", enabled: false },
		{ monthly: undefined, yearly: "price_kiosk_year", enabled: false },
		{ monthly: undefined, yearly: undefined, enabled: false },
		// A blank ID is unset, the same for the app, the worker and the reconcile script.
		{ monthly: "price_kiosk_month", yearly: "  ", enabled: false },
		{ monthly: " price_kiosk_month ", yearly: "price_kiosk_year\n", enabled: true },
	])("kiosk seats are on only when both kiosk prices are set ($monthly, $yearly)", ({
		monthly,
		yearly,
		enabled,
	}) => {
		expect(kioskSeatsEnabled({ priceKioskMonthlyId: monthly, priceKioskYearlyId: yearly })).toBe(
			enabled,
		);
	});

	it("finds the kiosk seat item by price wherever it sits", () => {
		const subscription = subscriptionWith(
			item("si_full", "price_full_month", 3),
			item("si_addon", "price_addon", 9),
			item("si_kiosk", "price_kiosk_year", 5),
		);

		expect(findKioskSeatItem(subscription, prices)?.id).toBe("si_kiosk");
	});

	it("finds no kiosk seat item while kiosk seats are off", () => {
		const subscription = subscriptionWith(item("si_kiosk", "price_kiosk_month", 5));

		expect(
			findKioskSeatItem(subscription, { ...prices, priceKioskYearlyId: "" }),
		).toBeUndefined();
	});

	it.each([
		{ enabled: true, kiosk: prices, ready: true },
		{ enabled: false, kiosk: prices, ready: false },
		{ enabled: true, kiosk: { ...prices, priceKioskYearlyId: " " }, ready: false },
	])(
		"the reconcile may run only with billing and kiosk seats on (billing $enabled)",
		({ enabled, kiosk, ready }) => {
			expect(kioskSeatReconcileConfigured({ enabled, ...kiosk })).toBe(ready);
		},
	);

	it("prices kiosk seats at the full seat item's interval", () => {
		expect(kioskSeatPriceFor(prices, item("si_full", "price_full_month"))).toBe(
			"price_kiosk_month",
		);
		expect(kioskSeatPriceFor(prices, item("si_full", "price_full_year"))).toBe(
			"price_kiosk_year",
		);
	});
});
