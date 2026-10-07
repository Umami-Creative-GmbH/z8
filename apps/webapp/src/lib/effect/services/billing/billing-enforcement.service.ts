import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { subscription } from "@/db/schema";
import { env } from "@/env";
import { BillingError, type DatabaseError } from "@/lib/effect/errors";
import {
	type BillingAccessResult,
	evaluateBillingAccess,
} from "@/lib/effect/services/billing/billing-access";
import { provisionLocalTrial } from "@/lib/effect/services/billing/billing-configuration";
import { DatabaseService } from "@/lib/effect/services/database.service";

export type { BillingAccessResult } from "@/lib/effect/services/billing/billing-access";

export interface CheckBillingAccessOptions {
	now?: Date;
	/**
	 * Provisions the default local trial in its own protected transaction. Work
	 * transactions use `readBillingAccessInTransaction` instead.
	 */
	createTrialIfMissing?: boolean;
}

function checkBillingAccess(
	dbService: DatabaseService["Service"],
	organizationId: string,
	{ now = new Date(), createTrialIfMissing = true }: CheckBillingAccessOptions = {},
) {
	return Effect.gen(function* () {
		const billingEnabled = env.BILLING_ENABLED === "true";

		if (!billingEnabled) {
			return evaluateBillingAccess({ billingEnabled, subscription: null, now });
		}

		const sub = yield* dbService.query("billing.checkAccess", async () => {
			if (createTrialIfMissing) return provisionLocalTrial(organizationId, now);
			const existing = await dbService.db.query.subscription.findFirst({
				where: eq(subscription.organizationId, organizationId),
			});
			return existing ?? null;
		});

		return evaluateBillingAccess({ billingEnabled, subscription: sub, now });
	});
}

/**
 * BillingEnforcementService - Checks subscription status for access control
 * Used by middleware and API routes to enforce read-only mode
 */
export class BillingEnforcementService extends Context.Service<
	BillingEnforcementService,
	{
		/**
		 * Check if an organization can access features (fast DB-only check)
		 */
		readonly checkBillingAccess: (
			organizationId: string,
			options?: CheckBillingAccessOptions,
		) => Effect.Effect<BillingAccessResult, DatabaseError>;

		/**
		 * Require active subscription, throws BillingError if not active
		 */
		readonly requireActiveSubscription: (
			organizationId: string,
		) => Effect.Effect<void, BillingError | DatabaseError>;

		/**
		 * Check if billing is enabled at all
		 */
		readonly isBillingEnabled: () => boolean;
	}
>()("BillingEnforcementService") {}

export const BillingEnforcementServiceLive = Layer.effect(
	BillingEnforcementService,
	Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		return BillingEnforcementService.of({
			isBillingEnabled: () => env.BILLING_ENABLED === "true",

			checkBillingAccess: (organizationId, options) =>
				checkBillingAccess(dbService, organizationId, options),

			requireActiveSubscription: (organizationId) =>
				Effect.gen(function* () {
					const access = yield* checkBillingAccess(dbService, organizationId);

					if (!access.canAccess) {
						return yield* Effect.fail(
							new BillingError({
								message: access.reason
									? `Billing access denied: ${access.reason}`
									: "Billing access denied",
								reason: access.reason ?? "subscription_required",
								organizationId,
							}),
						);
					}
				}),
		});
	}),
);
