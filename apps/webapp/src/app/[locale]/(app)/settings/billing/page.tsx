import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BillingPageClient } from "@/components/billing/billing-page-client";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { env } from "@/env";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	type BillingAccessResult,
	BillingEnforcementService,
	BillingEnforcementServiceLive,
	type SubscriptionInfo,
	SubscriptionService,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
import { createLogger } from "@/lib/logger";

const logger = createLogger("billing-settings-page");
const billingCheckFailedAccess: BillingAccessResult = {
	canAccess: false,
	state: "suspended",
	reason: "subscription_required",
	status: "billing_check_failed",
};

async function BillingSettingsContent() {
	await connection();

	// Check if billing is enabled
	if (env.BILLING_ENABLED !== "true") {
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
	const program = Effect.flatMap(SubscriptionService, (subscriptionService) =>
		Effect.flatMap(BillingEnforcementService, (enforcementService) =>
			Effect.all({
				subscription: subscriptionService.getByOrganization(organizationId),
				accessResult: enforcementService.checkBillingAccess(organizationId),
			}),
		),
	);

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

function BillingSettingsLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function BillingSettingsPage() {
	return (
		<Suspense fallback={<BillingSettingsLoading />}>
			<BillingSettingsContent />
		</Suspense>
	);
}
