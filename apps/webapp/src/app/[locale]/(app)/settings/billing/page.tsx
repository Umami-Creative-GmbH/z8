import { connection } from "next/server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	type BillingAccessResult,
	type SubscriptionInfo,
	SubscriptionService,
	SubscriptionServiceLive,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
} from "@/lib/effect/services/billing";
import { BillingPageClient } from "@/components/billing/billing-page-client";
import { createLogger } from "@/lib/logger";

const logger = createLogger("billing-settings-page");
const billingCheckFailedAccess: BillingAccessResult = {
	canAccess: false,
	state: "suspended",
	reason: "subscription_required",
	status: "billing_check_failed",
};

export default async function BillingSettingsPage() {
	await connection();

	// Check if billing is enabled
	if (process.env.BILLING_ENABLED !== "true") {
		redirect("/settings");
	}

	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();

	// Get member record to check role
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	// Fetch subscription info
	const program = Effect.gen(function* () {
		const subscriptionService = yield* SubscriptionService;
		const enforcementService = yield* BillingEnforcementService;

		const subscription = yield* subscriptionService.getByOrganization(organizationId);
		const accessResult = yield* enforcementService.checkBillingAccess(organizationId);

		return { subscription, accessResult };
	});

	let subscription: SubscriptionInfo | null = null;
	let accessResult: BillingAccessResult = billingCheckFailedAccess;

	try {
		const result = await Effect.runPromise(
			program.pipe(
				Effect.provide(SubscriptionServiceLive),
				Effect.provide(BillingEnforcementServiceLive),
			),
		);
		subscription = result.subscription;
		accessResult = result.accessResult;
	} catch (error) {
		logger.error({ error, organizationId }, "Billing settings check failed");
	}

	const serializedAccessResult = {
		canAccess: accessResult.canAccess,
		reason: accessResult.reason,
		trialEndsAt: accessResult.trialEndsAt?.toISOString() ?? null,
		status: accessResult.status,
	};

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
			accessResult={serializedAccessResult}
			isOwner={memberRecord?.role === "owner"}
		/>
	);
}
