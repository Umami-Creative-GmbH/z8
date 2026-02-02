import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { BillingError, DatabaseError } from "../../errors";

export interface BillingAccessResult {
	canAccess: boolean;
	reason?: "subscription_required" | "trial_expired" | "payment_failed" | "canceled";
	trialEndsAt?: Date | null;
	status?: string;
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
		isBillingEnabled: () => process.env.BILLING_ENABLED === "true",

		checkBillingAccess: (organizationId) =>
			Effect.gen(function* () {
				// If billing is not enabled, always allow
				if (process.env.BILLING_ENABLED !== "true") {
					return { canAccess: true };
				}

				const sub = yield* Effect.tryPromise({
					try: async () => {
						return await db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						});
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check billing access",
							operation: "checkBillingAccess",
							table: "subscription",
							cause: error,
						}),
				});

				// No subscription record = needs to subscribe
				if (!sub) {
					return {
						canAccess: false,
						reason: "subscription_required" as const,
					};
				}

				// Check status
				switch (sub.status) {
					case "trialing":
						// Check if trial has expired
						if (sub.trialEnd && sub.trialEnd < new Date()) {
							return {
								canAccess: false,
								reason: "trial_expired" as const,
								trialEndsAt: sub.trialEnd,
								status: sub.status,
							};
						}
						return {
							canAccess: true,
							trialEndsAt: sub.trialEnd,
							status: sub.status,
						};

					case "active":
						return {
							canAccess: true,
							status: sub.status,
						};

					case "past_due":
						// Allow read access but this is a warning state
						return {
							canAccess: false,
							reason: "payment_failed" as const,
							status: sub.status,
						};

					case "canceled":
					case "unpaid":
						return {
							canAccess: false,
							reason: "canceled" as const,
							status: sub.status,
						};

					default:
						// Unknown status - be conservative
						return {
							canAccess: false,
							reason: "subscription_required" as const,
							status: sub.status,
						};
				}
			}),

		requireActiveSubscription: (organizationId) =>
			Effect.gen(function* () {
				// If billing is not enabled, always pass
				if (process.env.BILLING_ENABLED !== "true") {
					return;
				}

				const sub = yield* Effect.tryPromise({
					try: async () => {
						return await db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						});
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to check subscription",
							operation: "requireActiveSubscription",
							table: "subscription",
							cause: error,
						}),
				});

				if (!sub) {
					return yield* Effect.fail(
						new BillingError({
							message: "No subscription found",
							reason: "subscription_required",
							organizationId,
						}),
					);
				}

				// Check if subscription is active
				const activeStatuses = ["trialing", "active"];
				if (!activeStatuses.includes(sub.status)) {
					const reason =
						sub.status === "past_due"
							? "payment_failed"
							: sub.status === "canceled" || sub.status === "unpaid"
								? "canceled"
								: "subscription_required";

					return yield* Effect.fail(
						new BillingError({
							message: `Subscription is ${sub.status}`,
							reason,
							organizationId,
						}),
					);
				}

				// For trialing, check if trial has expired
				if (sub.status === "trialing" && sub.trialEnd && sub.trialEnd < new Date()) {
					return yield* Effect.fail(
						new BillingError({
							message: "Trial has expired",
							reason: "trial_expired",
							organizationId,
						}),
					);
				}
			}),
	}),
);
