import { count, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { subscription } from "@/db/schema";
import { env } from "@/env";
import { BillingError, DatabaseError } from "../../errors";
import { type BillingAccessResult, evaluateBillingAccess } from "./billing-access";

export type { BillingAccessResult } from "./billing-access";

export interface CheckBillingAccessOptions {
	now?: Date;
	createTrialIfMissing?: boolean;
}

function checkBillingAccess(
	organizationId: string,
	{ now = new Date(), createTrialIfMissing = true }: CheckBillingAccessOptions = {},
) {
	return Effect.gen(function* () {
		const billingEnabled = env.BILLING_ENABLED === "true";

		if (!billingEnabled) {
			return evaluateBillingAccess({ billingEnabled, subscription: null, now });
		}

		const sub = yield* Effect.tryPromise({
			try: async () => {
				const existing = await db.query.subscription.findFirst({
					where: eq(subscription.organizationId, organizationId),
				});

				if (existing || !createTrialIfMissing) return existing ?? null;

				const trialEnd = DateTime.fromJSDate(now, { zone: "utc" }).plus({ days: 14 }).toJSDate();
				const [memberCountResult] = await db
					.select({ count: count() })
					.from(member)
					.where(eq(member.organizationId, organizationId));
				const currentSeats = memberCountResult?.count ?? 0;
				const inserted = await db
					.insert(subscription)
					.values({
						organizationId,
						stripeCustomerId: null,
						status: "trialing",
						trialStart: now,
						trialEnd,
						currentSeats,
					})
					.onConflictDoNothing({ target: subscription.organizationId })
					.returning();

				const localTrial = inserted[0];
				if (localTrial) return localTrial;

				const raced = await db.query.subscription.findFirst({
					where: eq(subscription.organizationId, organizationId),
				});

				if (!raced) {
					throw new Error("Local trial insert returned no row");
				}

				return raced;
			},
			catch: (error) =>
				new DatabaseError({
					message: "Failed to check billing access",
					operation: "checkBillingAccess",
					table: "subscription",
					cause: error,
				}),
		});

		return evaluateBillingAccess({ billingEnabled, subscription: sub, now });
	});
}

/**
 * BillingEnforcementService - Checks subscription status for access control
 * Used by middleware and API routes to enforce read-only mode
 */
export class BillingEnforcementService extends Context.Tag("BillingEnforcementService")<
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
>() {}

export const BillingEnforcementServiceLive = Layer.succeed(
	BillingEnforcementService,
	BillingEnforcementService.of({
		isBillingEnabled: () => env.BILLING_ENABLED === "true",

		checkBillingAccess,

		requireActiveSubscription: (organizationId) =>
			Effect.gen(function* () {
				const access = yield* checkBillingAccess(organizationId);

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
	}),
);
