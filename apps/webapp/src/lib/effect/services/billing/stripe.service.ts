import { Context, Effect, Layer } from "effect";
import Stripe from "stripe";
import { StripeError } from "../../errors";

export interface StripeConfig {
	secretKey: string;
	webhookSecret: string;
	priceMonthlyId: string;
	priceYearlyId: string;
	enabled: boolean;
}

/**
 * StripeService - Thin wrapper over Stripe SDK
 * Handles all Stripe API calls with proper error handling
 */
export class StripeService extends Context.Tag("StripeService")<
	StripeService,
	{
		readonly client: Stripe | null;
		readonly config: StripeConfig;

		readonly createCustomer: (params: {
			email: string;
			name: string;
			organizationId: string;
			metadata?: Record<string, string>;
		}) => Effect.Effect<Stripe.Customer, StripeError>;

		readonly getCustomer: (customerId: string) => Effect.Effect<Stripe.Customer, StripeError>;

		readonly createCheckoutSession: (params: {
			customerId: string;
			priceId: string;
			organizationId: string;
			quantity: number;
			successUrl: string;
			cancelUrl: string;
			trialPeriodDays?: number;
		}) => Effect.Effect<Stripe.Checkout.Session, StripeError>;

		readonly createPortalSession: (params: {
			customerId: string;
			returnUrl: string;
		}) => Effect.Effect<Stripe.BillingPortal.Session, StripeError>;

		readonly getSubscription: (
			subscriptionId: string,
		) => Effect.Effect<Stripe.Subscription, StripeError>;

		readonly updateSubscription: (
			subscriptionId: string,
			params: Stripe.SubscriptionUpdateParams,
		) => Effect.Effect<Stripe.Subscription, StripeError>;

		readonly cancelSubscription: (
			subscriptionId: string,
			params?: { cancelAtPeriodEnd?: boolean },
		) => Effect.Effect<Stripe.Subscription, StripeError>;

		readonly constructWebhookEvent: (
			body: string,
			signature: string,
		) => Effect.Effect<Stripe.Event, StripeError>;
	}
>() {}

export const StripeServiceLive = Layer.effect(
	StripeService,
	Effect.sync(() => {
		const config: StripeConfig = {
			secretKey: process.env.STRIPE_SECRET_KEY || "",
			webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
			priceMonthlyId: process.env.STRIPE_PRICE_MONTHLY_ID || "",
			priceYearlyId: process.env.STRIPE_PRICE_YEARLY_ID || "",
			enabled: process.env.BILLING_ENABLED === "true",
		};

		const stripe = config.enabled && config.secretKey
			? new Stripe(config.secretKey, {
					typescript: true,
				})
			: null;

		return StripeService.of({
			client: stripe,
			config,

			createCustomer: (params) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return await stripe.customers.create({
							email: params.email,
							name: params.name,
							metadata: {
								organizationId: params.organizationId,
								...params.metadata,
							},
						});
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to create Stripe customer",
							operation: "createCustomer",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			getCustomer: (customerId) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						const customer = await stripe.customers.retrieve(customerId);
						if (customer.deleted) {
							throw new Error("Customer has been deleted");
						}
						return customer as Stripe.Customer;
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to get Stripe customer",
							operation: "getCustomer",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			createCheckoutSession: (params) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return await stripe.checkout.sessions.create({
							customer: params.customerId,
							mode: "subscription",
							line_items: [
								{
									price: params.priceId,
									quantity: params.quantity,
								},
							],
							success_url: params.successUrl,
							cancel_url: params.cancelUrl,
							subscription_data: {
								metadata: { organizationId: params.organizationId },
								trial_period_days: params.trialPeriodDays,
							},
							allow_promotion_codes: true,
							billing_address_collection: "auto",
							tax_id_collection: { enabled: true },
						});
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to create checkout session",
							operation: "createCheckoutSession",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			createPortalSession: (params) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return await stripe.billingPortal.sessions.create({
							customer: params.customerId,
							return_url: params.returnUrl,
						});
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to create portal session",
							operation: "createPortalSession",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			getSubscription: (subscriptionId) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return await stripe.subscriptions.retrieve(subscriptionId);
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to get subscription",
							operation: "getSubscription",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			updateSubscription: (subscriptionId, params) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return await stripe.subscriptions.update(subscriptionId, params);
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to update subscription",
							operation: "updateSubscription",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			cancelSubscription: (subscriptionId, params) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						if (params?.cancelAtPeriodEnd) {
							return await stripe.subscriptions.update(subscriptionId, {
								cancel_at_period_end: true,
							});
						}
						return await stripe.subscriptions.cancel(subscriptionId);
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to cancel subscription",
							operation: "cancelSubscription",
							stripeCode: (error as Stripe.StripeRawError)?.code,
							cause: error,
						}),
				}),

			constructWebhookEvent: (body, signature) =>
				Effect.tryPromise({
					try: async () => {
						if (!stripe) {
							throw new Error("Stripe not configured");
						}
						return stripe.webhooks.constructEvent(body, signature, config.webhookSecret);
					},
					catch: (error) =>
						new StripeError({
							message: "Failed to verify webhook signature",
							operation: "constructWebhookEvent",
							cause: error,
						}),
				}),
		});
	}),
);
