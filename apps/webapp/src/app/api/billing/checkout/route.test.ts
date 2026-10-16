import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import type { StripeConfig } from "@/lib/effect/services/billing/stripe.service";

const state = vi.hoisted(() => ({
	config: {} as Record<string, unknown>,
	seats: { full: 0, kiosk: 0 },
	countBillableSeatsByType: vi.fn(),
	createCheckoutSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "user_123", email: "owner@example.com" },
				session: { activeOrganizationId: "org_123" },
			}),
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: async () => ({ cannot: () => false }) }));
vi.mock("@/db", () => ({
	db: {
		query: { organization: { findFirst: async () => ({ id: "org_123", name: "Acme" }) } },
	},
}));
vi.mock("@/lib/app-url", () => ({ getDefaultAppBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/effect/runtime", () => ({
	runtime: { runPromise: (effect: Effect.Effect<unknown>) => Effect.runPromise(effect) },
}));
vi.mock("@/lib/effect/services/billing/billable-seat-count", () => ({
	countBillableSeatsByType: state.countBillableSeatsByType,
}));
vi.mock("@/lib/effect/services/billing", async (importOriginal) => {
	const billing = await importOriginal<typeof import("@/lib/effect/services/billing")>();
	const stripeLayer = Layer.effect(
		billing.StripeService,
		Effect.sync(() =>
			billing.StripeService.of({
				config: state.config,
				createCustomer: () => Effect.succeed({ id: "cus_123" }),
				createCheckoutSession: state.createCheckoutSession,
			} as never),
		),
	);
	const subscriptionLayer = Layer.succeed(
		billing.SubscriptionService,
		billing.SubscriptionService.of({
			getByOrganization: () => Effect.succeed(null),
			setStripeCustomerId: () => Effect.void,
		} as never),
	);
	return { ...billing, BillingServicesLive: Layer.mergeAll(stripeLayer, subscriptionLayer) };
});

import { POST } from "./route";

const kioskOn: StripeConfig = {
	secretKey: "rk_test_123",
	webhookSecret: "whsec_test_123",
	priceMonthlyId: "price_monthly_123",
	priceYearlyId: "price_yearly_123",
	priceKioskMonthlyId: "price_kiosk_monthly_123",
	priceKioskYearlyId: "price_kiosk_yearly_123",
	enabled: true,
};
const kioskOff: StripeConfig = { ...kioskOn, priceKioskMonthlyId: "", priceKioskYearlyId: "" };

function checkout(interval: "month" | "year") {
	return POST(
		new Request("https://app.test/api/billing/checkout", {
			method: "POST",
			body: JSON.stringify({ interval }),
		}) as never,
	);
}

function checkoutParams() {
	return state.createCheckoutSession.mock.calls[0]?.[0];
}

describe("POST /api/billing/checkout seat line items (#886)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		state.config = kioskOn;
		state.createCheckoutSession.mockReturnValue(
			Effect.succeed({ url: "https://checkout.stripe.test/session" }),
		);
		// Kiosk off counts every seat as a full seat, like countBillableSeatsByType does.
		state.countBillableSeatsByType.mockImplementation(
			async (_database: unknown, _organizationId: string, options: { kioskSeats: boolean }) =>
				options.kioskSeats ? state.seats : { full: state.seats.full + state.seats.kiosk, kiosk: 0 },
		);
	});

	it.each([
		{ interval: "month" as const, full: "price_monthly_123", kiosk: "price_kiosk_monthly_123" },
		{ interval: "year" as const, full: "price_yearly_123", kiosk: "price_kiosk_yearly_123" },
	])(
		"sends 2 full and 4 kiosk seats at the $interval prices",
		async ({ interval, full, kiosk }) => {
			state.seats = { full: 2, kiosk: 4 };

			const response = await checkout(interval);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ url: "https://checkout.stripe.test/session" });
			expect(state.countBillableSeatsByType).toHaveBeenCalledWith(expect.anything(), "org_123", {
				kioskSeats: true,
			});
			expect(checkoutParams()).toMatchObject({
				organizationId: "org_123",
				priceId: full,
				quantity: 2,
				kiosk: { priceId: kiosk, quantity: 4 },
			});
		},
	);

	it("sends only the full seat line for an organization without kiosk seats", async () => {
		state.seats = { full: 3, kiosk: 0 };

		await checkout("month");

		expect(checkoutParams()).toMatchObject({ priceId: "price_monthly_123", quantity: 3 });
		expect(checkoutParams()?.kiosk).toBeUndefined();
	});

	it("keeps at least one full seat when every seat is a kiosk seat", async () => {
		state.seats = { full: 0, kiosk: 4 };

		await checkout("month");

		expect(checkoutParams()).toMatchObject({
			quantity: 1,
			kiosk: { priceId: "price_kiosk_monthly_123", quantity: 4 },
		});
	});

	it("checks out every seat as a full seat while kiosk seats are off", async () => {
		state.config = kioskOff;
		state.seats = { full: 2, kiosk: 4 };

		await checkout("year");

		expect(state.countBillableSeatsByType).toHaveBeenCalledWith(expect.anything(), "org_123", {
			kioskSeats: false,
		});
		expect(checkoutParams()).toMatchObject({ priceId: "price_yearly_123", quantity: 6 });
		expect(checkoutParams()?.kiosk).toBeUndefined();
	});
});
