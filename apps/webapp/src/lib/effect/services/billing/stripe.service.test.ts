import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { StripeService, StripeServiceLive } from "./stripe.service";

const checkoutSessionsCreate = vi.fn(
	async (params: Record<string, unknown>) => ({
		id: "cs_test_123",
		url: "https://checkout.stripe.test/session",
		params,
	}),
);

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
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		(env as { STRIPE_SECRET_KEY: string }).STRIPE_SECRET_KEY = "rk_test_123";
		(env as { STRIPE_WEBHOOK_SECRET: string }).STRIPE_WEBHOOK_SECRET =
			"whsec_test_123";
		(env as { STRIPE_PRICE_MONTHLY_ID: string }).STRIPE_PRICE_MONTHLY_ID =
			"price_monthly_123";
		(env as { STRIPE_PRICE_YEARLY_ID: string }).STRIPE_PRICE_YEARLY_ID =
			"price_yearly_123";
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

	it("passes positive trial days to subscription checkout sessions", async () => {
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
					trialPeriodDays: 6,
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(checkoutSessionsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				subscription_data: expect.objectContaining({
					metadata: { organizationId: "org_123" },
					trial_period_days: 6,
				}),
			}),
		);
	});

	it("omits trial days from subscription checkout sessions when zero", async () => {
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
					trialPeriodDays: 0,
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		const checkoutParams = checkoutSessionsCreate.mock.calls[0]?.[0] as {
			subscription_data?: Record<string, unknown>;
		};

		expect(checkoutParams.subscription_data).toEqual({
			metadata: { organizationId: "org_123" },
		});
	});

	it("checkout route computes remaining trial days instead of starting a fresh trial", () => {
		const routeSource = readFileSync(
			join(process.cwd(), "src/app/api/billing/checkout/route.ts"),
			"utf8",
		);

		expect(routeSource).toContain("getDaysRemaining");
		expect(routeSource).toContain("getDaysRemaining(existing.trialEnd)");
		expect(routeSource).not.toContain("trialPeriodDays: 14");
	});
});
