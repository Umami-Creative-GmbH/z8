import { count, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { connection, type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	StripeService,
	StripeServiceLive,
	SubscriptionService,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingCheckout");

/**
 * Create a Stripe checkout session for subscription
 * Endpoint: POST /api/billing/checkout
 *
 * Body: { interval: "month" | "year" }
 * Requires: Owner or Admin role in the organization
 * Returns: { url: string } - URL to redirect to Stripe checkout
 */
export async function POST(request: NextRequest) {
	await connection();

	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		return NextResponse.json({ error: "Billing not enabled" }, { status: 404 });
	}

	// Auth check
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const organizationId = session.session?.activeOrganizationId;
	if (!organizationId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	// Check authorization - owner or admin can manage billing
	const ability = await getAbility();
	if (!ability || ability.cannot("manage", "OrgBilling")) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Parse body
	let interval: "month" | "year";
	try {
		const body = await request.json();
		interval = body.interval === "year" ? "year" : "month";
	} catch {
		interval = "month";
	}

	const program = Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;
		const appUrl = getDefaultAppBaseUrl();

		// Check if subscription already exists
		const existing = yield* subscriptionService.getByOrganization(organizationId);
		if (existing?.stripeSubscriptionId && existing.status !== "canceled") {
			return yield* Effect.fail(new Error("Organization already has an active subscription"));
		}

		// Get organization details
		const org = yield* Effect.promise(() =>
			db.query.organization.findFirst({
				where: eq(organization.id, organizationId),
			}),
		);

		if (!org) {
			return yield* Effect.fail(new Error("Organization not found"));
		}

		// Count current members for initial seats
		const [memberCountResult] = yield* Effect.promise(() =>
			db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
		);
		const seatCount = Math.max(memberCountResult?.count ?? 1, 1);

		// Create or get Stripe customer
		let customerId: string;
		if (existing?.stripeCustomerId) {
			customerId = existing.stripeCustomerId;
		} else {
			const customer = yield* stripeService.createCustomer({
				email: session.user.email,
				name: org.name,
				organizationId: org.id,
			});
			customerId = customer.id;

			// Store customer ID
			yield* subscriptionService.setStripeCustomerId(organizationId, customerId);
		}

		// Determine price ID
		const priceId =
			interval === "year"
				? stripeService.config.priceYearlyId
				: stripeService.config.priceMonthlyId;

		if (!priceId) {
			return yield* Effect.fail(new Error("Price not configured"));
		}

		// Create checkout session with 14-day trial
		const checkoutSession = yield* stripeService.createCheckoutSession({
			customerId,
			priceId,
			organizationId: org.id,
			quantity: seatCount,
			successUrl: `${appUrl}/settings/billing?success=true`,
			cancelUrl: `${appUrl}/settings/billing?canceled=true`,
			trialPeriodDays: 14,
		});

		logger.info({ organizationId, customerId, interval, seatCount }, "Checkout session created");

		return { url: checkoutSession.url };
	});

	try {
		const result = await Effect.runPromise(
			program.pipe(Effect.provide(StripeServiceLive), Effect.provide(SubscriptionServiceLive)),
		);
		return NextResponse.json(result);
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to create checkout session");
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to create checkout session" },
			{ status: 500 },
		);
	}
}
