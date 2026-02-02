import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import {
	SubscriptionService,
	SubscriptionServiceLive,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing";
import { BillingPageClient } from "@/components/billing/billing-page-client";

export default async function BillingSettingsPage() {
	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		redirect("/settings");
	}

	const authContext = await requireUser();

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	// Get member record to check role
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	// Only owners and admins can access billing
	if (memberRecord?.role !== "owner" && memberRecord?.role !== "admin") {
		redirect("/settings");
	}

	// Fetch subscription info
	const program = Effect.gen(function* () {
		const subscriptionService = yield* SubscriptionService;
		const enforcementService = yield* BillingEnforcementService;

		const subscription = yield* subscriptionService.getByOrganization(organizationId);
		const accessResult = yield* enforcementService.checkBillingAccess(organizationId);

		return { subscription, accessResult };
	});

	let subscription = null;
	let accessResult = { canAccess: true };

	try {
		const result = await Effect.runPromise(
			program.pipe(
				Effect.provide(SubscriptionServiceLive),
				Effect.provide(BillingEnforcementServiceLive),
			),
		);
		subscription = result.subscription;
		accessResult = result.accessResult;
	} catch {
		// If billing service fails, show empty state
	}

	return (
		<BillingPageClient
			subscription={
				subscription
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
					: null
			}
			accessResult={accessResult}
			isOwner={memberRecord?.role === "owner"}
		/>
	);
}
