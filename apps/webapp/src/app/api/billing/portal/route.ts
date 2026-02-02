import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";
import {
	StripeService,
	StripeServiceLive,
	SubscriptionService,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";

const logger = createLogger("BillingPortal");

/**
 * Create a Stripe billing portal session
 * Endpoint: POST /api/billing/portal
 *
 * Requires: Owner or Admin role in the organization
 * Returns: { url: string } - URL to redirect to Stripe portal
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

	// Parse body for return URL
	let returnUrl: string;
	try {
		const body = await request.json();
		returnUrl = body.returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`;
	} catch {
		returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`;
	}

	const program = Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;

		// Get subscription to find customer ID
		const sub = yield* subscriptionService.getByOrganization(organizationId);

		if (!sub?.stripeCustomerId) {
			return yield* Effect.fail(new Error("No billing account found"));
		}

		// Create portal session
		const portalSession = yield* stripeService.createPortalSession({
			customerId: sub.stripeCustomerId,
			returnUrl,
		});

		logger.info(
			{ organizationId, customerId: sub.stripeCustomerId },
			"Billing portal session created",
		);

		return { url: portalSession.url };
	});

	try {
		const result = await Effect.runPromise(
			program.pipe(
				Effect.provide(StripeServiceLive),
				Effect.provide(SubscriptionServiceLive),
			),
		);
		return NextResponse.json(result);
	} catch (error) {
		logger.error({ error, organizationId }, "Failed to create portal session");
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to create portal session" },
			{ status: 500 },
		);
	}
}
