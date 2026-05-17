import { Effect } from "effect";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StripeService, StripeServiceLive } from "./stripe.service";

const checkoutSessionsCreate = vi.fn(async (params: Record<string, unknown>) => ({
	id: "cs_test_123",
	url: "https://checkout.stripe.test/session",
	params,
}));

vi.mock("stripe", () => ({
	default: vi.fn().mockImplementation(function StripeMock() {
		return {
			checkout: {
				sessions: {
					create: checkoutSessionsCreate,
				},
			},
		};
	}),
}));

describe("StripeService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("BILLING_ENABLED", "true");
		vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_123");
		vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_123");
		vi.stubEnv("STRIPE_PRICE_MONTHLY_ID", "price_monthly_123");
		vi.stubEnv("STRIPE_PRICE_YEARLY_ID", "price_yearly_123");
	});

	it("pins the Stripe SDK to the latest Dahlia API version", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* StripeService;
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(Stripe).toHaveBeenCalledWith(
			"rk_test_123",
			expect.objectContaining({
				apiVersion: "2026-04-22.dahlia",
			}),
		);
	});

	it("adds organization metadata to checkout sessions and subscriptions", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const stripeService = yield* StripeService;

				yield* stripeService.createCheckoutSession({
					customerId: "cus_test_123",
					priceId: "price_monthly_123",
					organizationId: "org_123",
					quantity: 5,
					successUrl: "https://app.test/settings/billing?success=true",
					cancelUrl: "https://app.test/settings/billing?canceled=true",
					trialPeriodDays: 14,
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(checkoutSessionsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { organizationId: "org_123" },
				subscription_data: expect.objectContaining({
					metadata: { organizationId: "org_123" },
				}),
			}),
		);
	});
});
