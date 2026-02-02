import { Context, Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscription } from "@/db/schema";
import { DatabaseError, NotFoundError } from "../../errors";

export interface SubscriptionInfo {
	id: string;
	organizationId: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string | null;
	status: string;
	isActive: boolean;
	isTrialing: boolean;
	isPastDue: boolean;
	currentSeats: number;
	trialEnd: Date | null;
	currentPeriodEnd: Date | null;
	billingInterval: string | null;
	cancelAt: Date | null;
}

export interface CreateSubscriptionParams {
	organizationId: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	status: string;
	billingInterval: string;
	trialEnd: Date | null;
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	seats: number;
}

export interface UpdateSubscriptionFromStripeParams {
	stripeSubscriptionId: string;
	status: string;
	currentPeriodStart: Date;
	currentPeriodEnd: Date;
	cancelAt?: Date | null;
	canceledAt?: Date | null;
	stripePriceId?: string;
	billingInterval?: string;
}

/**
 * SubscriptionService - CRUD operations for subscription records
 * Manages subscription state in the database
 */
export class SubscriptionService extends Context.Tag("SubscriptionService")<
	SubscriptionService,
	{
		readonly getByOrganization: (
			organizationId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly getByStripeCustomerId: (
			stripeCustomerId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly getByStripeSubscriptionId: (
			stripeSubscriptionId: string,
		) => Effect.Effect<SubscriptionInfo | null, DatabaseError>;

		readonly requireActiveSubscription: (
			organizationId: string,
		) => Effect.Effect<SubscriptionInfo, NotFoundError | DatabaseError>;

		readonly create: (params: CreateSubscriptionParams) => Effect.Effect<void, DatabaseError>;

		readonly updateFromStripe: (
			params: UpdateSubscriptionFromStripeParams,
		) => Effect.Effect<void, DatabaseError>;

		readonly updateSeatCount: (
			organizationId: string,
			seats: number,
		) => Effect.Effect<void, DatabaseError>;

		readonly setStripeCustomerId: (
			organizationId: string,
			stripeCustomerId: string,
		) => Effect.Effect<void, DatabaseError>;

		readonly canMutateData: (organizationId: string) => Effect.Effect<boolean, DatabaseError>;
	}
>() {}

function mapToSubscriptionInfo(sub: typeof subscription.$inferSelect): SubscriptionInfo {
	const activeStatuses = ["trialing", "active"];
	return {
		id: sub.id,
		organizationId: sub.organizationId,
		stripeCustomerId: sub.stripeCustomerId,
		stripeSubscriptionId: sub.stripeSubscriptionId,
		status: sub.status,
		isActive: activeStatuses.includes(sub.status),
		isTrialing: sub.status === "trialing",
		isPastDue: sub.status === "past_due",
		currentSeats: sub.currentSeats,
		trialEnd: sub.trialEnd,
		currentPeriodEnd: sub.currentPeriodEnd,
		billingInterval: sub.billingInterval,
		cancelAt: sub.cancelAt,
	};
}

export const SubscriptionServiceLive = Layer.succeed(
	SubscriptionService,
	SubscriptionService.of({
		getByOrganization: (organizationId) =>
			Effect.tryPromise({
				try: async () => {
					const sub = await db.query.subscription.findFirst({
						where: eq(subscription.organizationId, organizationId),
					});

					if (!sub) return null;
					return mapToSubscriptionInfo(sub);
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to get subscription",
						operation: "getByOrganization",
						table: "subscription",
						cause: error,
					}),
			}),

		getByStripeCustomerId: (stripeCustomerId) =>
			Effect.tryPromise({
				try: async () => {
					const sub = await db.query.subscription.findFirst({
						where: eq(subscription.stripeCustomerId, stripeCustomerId),
					});

					if (!sub) return null;
					return mapToSubscriptionInfo(sub);
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to get subscription by customer ID",
						operation: "getByStripeCustomerId",
						table: "subscription",
						cause: error,
					}),
			}),

		getByStripeSubscriptionId: (stripeSubscriptionId) =>
			Effect.tryPromise({
				try: async () => {
					const sub = await db.query.subscription.findFirst({
						where: eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
					});

					if (!sub) return null;
					return mapToSubscriptionInfo(sub);
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to get subscription by subscription ID",
						operation: "getByStripeSubscriptionId",
						table: "subscription",
						cause: error,
					}),
			}),

		requireActiveSubscription: (organizationId) =>
			Effect.gen(function* () {
				const sub = yield* Effect.tryPromise({
					try: async () => {
						return await db.query.subscription.findFirst({
							where: eq(subscription.organizationId, organizationId),
						});
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to get subscription",
							operation: "requireActiveSubscription",
							table: "subscription",
							cause: error,
						}),
				});

				if (!sub) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "No subscription found",
							entityType: "subscription",
							entityId: organizationId,
						}),
					);
				}

				return mapToSubscriptionInfo(sub);
			}),

		create: (params) =>
			Effect.tryPromise({
				try: async () => {
					await db.insert(subscription).values({
						organizationId: params.organizationId,
						stripeCustomerId: params.stripeCustomerId,
						stripeSubscriptionId: params.stripeSubscriptionId,
						stripePriceId: params.stripePriceId,
						status: params.status,
						billingInterval: params.billingInterval,
						trialStart: params.trialEnd ? new Date() : null,
						trialEnd: params.trialEnd,
						currentPeriodStart: params.currentPeriodStart,
						currentPeriodEnd: params.currentPeriodEnd,
						currentSeats: params.seats,
					});
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to create subscription",
						operation: "create",
						table: "subscription",
						cause: error,
					}),
			}),

		updateFromStripe: (params) =>
			Effect.tryPromise({
				try: async () => {
					await db
						.update(subscription)
						.set({
							status: params.status,
							currentPeriodStart: params.currentPeriodStart,
							currentPeriodEnd: params.currentPeriodEnd,
							cancelAt: params.cancelAt,
							canceledAt: params.canceledAt,
							stripePriceId: params.stripePriceId,
							billingInterval: params.billingInterval,
							updatedAt: new Date(),
						})
						.where(eq(subscription.stripeSubscriptionId, params.stripeSubscriptionId));
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to update subscription",
						operation: "updateFromStripe",
						table: "subscription",
						cause: error,
					}),
			}),

		updateSeatCount: (organizationId, seats) =>
			Effect.tryPromise({
				try: async () => {
					await db
						.update(subscription)
						.set({
							currentSeats: seats,
							lastSeatReportedAt: new Date(),
						})
						.where(eq(subscription.organizationId, organizationId));
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to update seat count",
						operation: "updateSeatCount",
						table: "subscription",
						cause: error,
					}),
			}),

		setStripeCustomerId: (organizationId, stripeCustomerId) =>
			Effect.tryPromise({
				try: async () => {
					// Check if subscription record exists
					const existing = await db.query.subscription.findFirst({
						where: eq(subscription.organizationId, organizationId),
					});

					if (existing) {
						await db
							.update(subscription)
							.set({ stripeCustomerId })
							.where(eq(subscription.organizationId, organizationId));
					} else {
						// Create a minimal subscription record with customer ID
						await db.insert(subscription).values({
							organizationId,
							stripeCustomerId,
							status: "incomplete",
							currentSeats: 0,
						});
					}
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to set Stripe customer ID",
						operation: "setStripeCustomerId",
						table: "subscription",
						cause: error,
					}),
			}),

		canMutateData: (organizationId) =>
			Effect.gen(function* () {
				// If billing is not enabled, allow all mutations
				if (process.env.BILLING_ENABLED !== "true") {
					return true;
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
							operation: "canMutateData",
							table: "subscription",
							cause: error,
						}),
				});

				// No subscription = cannot mutate (needs to subscribe)
				if (!sub) return false;

				// Check status
				const blockedStatuses = ["canceled", "unpaid", "past_due"];
				if (blockedStatuses.includes(sub.status)) {
					return false;
				}

				return true;
			}),
	}),
);
