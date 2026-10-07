import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "@/env";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { BillingServicesLive } from "./index";
import { STRIPE_API_VERSION, StripeService, StripeServiceLive } from "./stripe.service";

const checkoutSessionsCreate = vi.fn(async (params: Record<string, unknown>) => ({
	id: "cs_test_123",
	url: "https://checkout.stripe.test/session",
	params,
}));

const { StripeMock, invoicePaymentsList, invoicesRetrieve } = vi.hoisted(() => ({
	StripeMock: vi.fn(),
	invoicePaymentsList: vi.fn(),
	invoicesRetrieve: vi.fn(),
}));

vi.mock("stripe", () => ({ default: StripeMock }));

const stubInvoice = { id: "in_test_123", object: "invoice" } as Stripe.Invoice;

function getInvoiceForPaymentIntent(paymentIntentId: string) {
	return Effect.runPromise(
		Effect.flatMap(StripeService, (service) =>
			service.getInvoiceForPaymentIntent(paymentIntentId),
		).pipe(Effect.provide(StripeServiceLive)),
	);
}

describe("StripeService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		StripeMock.mockImplementation(function StripeMockClient() {
			return {
				checkout: {
					sessions: {
						create: checkoutSessionsCreate,
					},
				},
				invoicePayments: { list: invoicePaymentsList },
				invoices: { retrieve: invoicesRetrieve },
			};
		});
		(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "true";
		(env as { STRIPE_SECRET_KEY: string }).STRIPE_SECRET_KEY = "rk_test_123";
		(env as { STRIPE_WEBHOOK_SECRET: string }).STRIPE_WEBHOOK_SECRET = "whsec_test_123";
		(env as { STRIPE_PRICE_MONTHLY_ID: string }).STRIPE_PRICE_MONTHLY_ID = "price_monthly_123";
		(env as { STRIPE_PRICE_YEARLY_ID: string }).STRIPE_PRICE_YEARLY_ID = "price_yearly_123";
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

	it("allows Stripe Checkout to update customer billing details for tax ID collection", async () => {
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
				});
			}).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(checkoutSessionsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				customer_update: { address: "auto", name: "auto" },
				tax_id_collection: { enabled: true },
			}),
		);
	});

	it("rejects product ids before creating checkout sessions", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const stripeService = yield* StripeService;

				return yield* stripeService.createCheckoutSession({
					customerId: "cus_test_123",
					priceId: "prod_123",
					organizationId: "org_123",
					quantity: 5,
					successUrl: "https://app.test/settings/billing?success=true",
					cancelUrl: "https://app.test/settings/billing?canceled=true",
				});
			}).pipe(Effect.provide(StripeServiceLive), Effect.result),
		);

		expect(result._tag).toBe("Failure");
		expect(result._tag === "Failure" ? result.failure : null).toMatchObject({
			message: "Stripe checkout price must be a Price ID starting with price_",
			operation: "createCheckoutSession",
		});

		expect(checkoutSessionsCreate).not.toHaveBeenCalled();
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

	it("pins the installed SDK's default API version", async () => {
		const { default: ActualStripe } = await vi.importActual<typeof import("stripe")>("stripe");
		// A key no earlier test used, so this run constructs the process's client for it.
		(env as { STRIPE_SECRET_KEY: string }).STRIPE_SECRET_KEY = "rk_test_pinned";

		await Effect.runPromise(
			Effect.flatMap(StripeService, () => Effect.void).pipe(Effect.provide(StripeServiceLive)),
		);

		expect(STRIPE_API_VERSION).toBe(ActualStripe.API_VERSION);
		expect(StripeMock).toHaveBeenCalledWith("rk_test_pinned", {
			apiVersion: STRIPE_API_VERSION,
			typescript: true,
		});
	});

	describe("client lifetime", () => {
		const readClient = () =>
			Effect.runPromise(
				Effect.map(StripeService, (service) => service.client).pipe(
					Effect.provide(BillingServicesLive),
					Effect.provide(DatabaseServiceLive),
				),
			);

		it("reuses one Stripe client across billing runs in a process", async () => {
			(env as { STRIPE_SECRET_KEY: string }).STRIPE_SECRET_KEY = "rk_test_reused";

			const first = await readClient();
			const second = await readClient();

			expect(first).not.toBeNull();
			expect(second).toBe(first);
			expect(StripeMock).toHaveBeenCalledTimes(1);
		});

		it("constructs no Stripe client while billing is disabled", async () => {
			(env as { BILLING_ENABLED: "true" | "false" }).BILLING_ENABLED = "false";
			(env as { STRIPE_SECRET_KEY: string }).STRIPE_SECRET_KEY = "rk_test_disabled";

			await expect(readClient()).resolves.toBeNull();
			await expect(readClient()).resolves.toBeNull();
			expect(StripeMock).not.toHaveBeenCalled();
		});
	});

	describe("getInvoiceForPaymentIntent", () => {
		it("finds the invoice through the payment intent's invoice payment", async () => {
			invoicePaymentsList.mockResolvedValue({ data: [{ invoice: stubInvoice }] });

			await expect(getInvoiceForPaymentIntent("pi_test_123")).resolves.toBe(stubInvoice);
			expect(invoicePaymentsList).toHaveBeenCalledWith({
				payment: { type: "payment_intent", payment_intent: "pi_test_123" },
				expand: ["data.invoice"],
				limit: 1,
			});
		});

		it("retrieves the invoice when the list did not expand it", async () => {
			invoicePaymentsList.mockResolvedValue({ data: [{ invoice: "in_test_123" }] });
			invoicesRetrieve.mockResolvedValue(stubInvoice);

			await expect(getInvoiceForPaymentIntent("pi_test_123")).resolves.toBe(stubInvoice);
			expect(invoicesRetrieve).toHaveBeenCalledWith("in_test_123");
		});

		it.each([
			{ payment: "has no invoice payment", data: [] },
			{
				payment: "pays a deleted invoice",
				data: [{ invoice: { id: "in_test_123", deleted: true } }],
			},
		])("returns null when the payment intent $payment", async ({ data }) => {
			invoicePaymentsList.mockResolvedValue({ data });

			await expect(getInvoiceForPaymentIntent("pi_test_123")).resolves.toBeNull();
		});

		it("fails with a StripeError when the lookup fails", async () => {
			invoicePaymentsList.mockRejectedValue(new Error("network down"));

			await expect(getInvoiceForPaymentIntent("pi_test_123")).rejects.toMatchObject({
				_tag: "StripeError",
				operation: "getInvoiceForPaymentIntent",
			});
		});
	});
});
