import { NextResponse } from "next/server";
import { connection } from "next/server";
import { headers } from "next/headers";
import { Effect } from "effect";
import { auth } from "@/lib/auth";
import {
	SubscriptionService,
	SubscriptionServiceLive,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing";

/**
 * Get current subscription status for the organization
 * Endpoint: GET /api/billing/subscription
 *
 * Returns subscription info including status, seats, trial end, etc.
 */
export async function GET() {
	await connection();

	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		return NextResponse.json({
			enabled: false,
			subscription: null,
		});
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

	const program = Effect.gen(function* () {
		const subscriptionService = yield* SubscriptionService;
		const enforcementService = yield* BillingEnforcementService;

		// Get subscription info
		const subscription = yield* subscriptionService.getByOrganization(organizationId);

		// Check billing access status
		const accessResult = yield* enforcementService.checkBillingAccess(organizationId);

		return {
			enabled: true,
			subscription: subscription
				? {
						id: subscription.id,
						status: subscription.status,
						isActive: subscription.isActive,
						isTrialing: subscription.isTrialing,
						isPastDue: subscription.isPastDue,
						currentSeats: subscription.currentSeats,
						trialEnd: subscription.trialEnd?.toISOString() ?? null,
						currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
						billingInterval: subscription.billingInterval,
						cancelAt: subscription.cancelAt?.toISOString() ?? null,
					}
				: null,
			access: accessResult,
		};
	});

	try {
		const result = await Effect.runPromise(
			program.pipe(
				Effect.provide(SubscriptionServiceLive),
				Effect.provide(BillingEnforcementServiceLive),
			),
		);
		return NextResponse.json(result);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to get subscription" },
			{ status: 500 },
		);
	}
}
