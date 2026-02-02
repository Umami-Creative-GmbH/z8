import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { Effect, Layer } from "effect";
import { createLogger } from "@/lib/logger";
import {
	StripeService,
	StripeServiceLive,
	BillingEventsService,
	BillingEventsServiceLive,
	SubscriptionServiceLive,
	SeatSyncServiceLive,
} from "@/lib/effect/services/billing";

const logger = createLogger("StripeWebhook");

/**
 * Stripe webhook handler
 * Endpoint: POST /api/billing/webhook
 *
 * Configure in Stripe dashboard:
 * - checkout.session.completed
 * - customer.subscription.created
 * - customer.subscription.updated
 * - customer.subscription.deleted
 * - customer.subscription.trial_will_end
 * - customer.subscription.paused
 * - customer.subscription.resumed
 * - invoice.payment_succeeded
 * - invoice.payment_failed
 * - invoice.finalized
 * - payment_intent.payment_failed
 */
export async function POST(request: NextRequest) {
	await connection();

	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		return NextResponse.json({ error: "Billing not enabled" }, { status: 404 });
	}

	const body = await request.text();
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		logger.warn("Webhook received without signature");
		return NextResponse.json({ error: "Missing signature" }, { status: 400 });
	}

	// Build service layers
	const layers = Layer.mergeAll(StripeServiceLive, SubscriptionServiceLive).pipe(
		Layer.provideMerge(
			SeatSyncServiceLive.pipe(
				Layer.provide(StripeServiceLive),
				Layer.provide(SubscriptionServiceLive),
			),
		),
		Layer.provideMerge(
			BillingEventsServiceLive.pipe(
				Layer.provide(StripeServiceLive),
				Layer.provide(SubscriptionServiceLive),
				Layer.provide(
					SeatSyncServiceLive.pipe(
						Layer.provide(StripeServiceLive),
						Layer.provide(SubscriptionServiceLive),
					),
				),
			),
		),
	);

	const program = Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const billingEventsService = yield* BillingEventsService;

		// Verify webhook signature
		const event = yield* stripeService.constructWebhookEvent(body, signature);

		logger.info({ eventId: event.id, eventType: event.type }, "Webhook received");

		// Process the event
		yield* billingEventsService.processEvent(event);

		return { received: true, eventId: event.id };
	});

	try {
		const result = await Effect.runPromise(program.pipe(Effect.provide(layers)));
		return NextResponse.json(result);
	} catch (error) {
		logger.error({ error }, "Webhook processing failed");

		// Check if it's a signature verification error
		if (error instanceof Error && error.message.includes("signature")) {
			return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
		}

		// For other errors, still return 200 to prevent Stripe retries for bad data
		// Real errors are logged and stored in stripe_event table
		return NextResponse.json({ error: "Processing failed" }, { status: 500 });
	}
}
