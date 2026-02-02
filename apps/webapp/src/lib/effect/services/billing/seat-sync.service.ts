import { Context, Effect, Layer } from "effect";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { subscription, billingSeatAudit } from "@/db/schema";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";
import { DatabaseError, StripeError } from "../../errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger("SeatSyncService");

/**
 * SeatSyncService - Real-time seat counting and Stripe usage reporting
 * Called from auth hooks when members are added/removed
 */
export class SeatSyncService extends Context.Tag("SeatSyncService")<
	SeatSyncService,
	{
		/**
		 * Count current members and sync to Stripe subscription
		 * Returns the new seat count
		 */
		readonly syncSeatsForOrganization: (
			organizationId: string,
		) => Effect.Effect<number, DatabaseError | StripeError>;

		/**
		 * Handle member added event - update seat count and report to Stripe
		 */
		readonly handleMemberAdded: (
			organizationId: string,
			memberId: string,
			userId: string,
		) => Effect.Effect<void, DatabaseError | StripeError>;

		/**
		 * Handle member removed event - update seat count and report to Stripe
		 */
		readonly handleMemberRemoved: (
			organizationId: string,
			memberId: string,
			userId: string,
		) => Effect.Effect<void, DatabaseError | StripeError>;

		/**
		 * Get current seat count for an organization without syncing
		 */
		readonly getCurrentSeatCount: (
			organizationId: string,
		) => Effect.Effect<number, DatabaseError>;
	}
>() {}

export const SeatSyncServiceLive = Layer.effect(
	SeatSyncService,
	Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;

		const syncSeatsForOrganization = (
			organizationId: string,
		): Effect.Effect<number, DatabaseError | StripeError> =>
			Effect.gen(function* () {
				// Count active members
				const [result] = yield* Effect.tryPromise({
					try: async () => {
						return await db
							.select({ count: count() })
							.from(member)
							.where(eq(member.organizationId, organizationId));
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to count members",
							operation: "syncSeatsForOrganization",
							table: "member",
							cause: error,
						}),
				});

				const seatCount = result?.count ?? 0;

				// Update subscription record
				yield* subscriptionService.updateSeatCount(organizationId, seatCount);

				// Get subscription to update Stripe
				const sub = yield* subscriptionService.getByOrganization(organizationId);

				if (sub?.stripeSubscriptionId && stripeService.config.enabled) {
					// Get subscription from Stripe to find subscription item
					const stripeSub = yield* stripeService.getSubscription(sub.stripeSubscriptionId);
					const subscriptionItem = stripeSub.items.data[0];

					if (subscriptionItem) {
						// Update subscription quantity in Stripe
						yield* stripeService.updateSubscription(sub.stripeSubscriptionId, {
							items: [
								{
									id: subscriptionItem.id,
									quantity: seatCount,
								},
							],
							proration_behavior: "create_prorations",
						});

						logger.info(
							{ organizationId, seatCount, subscriptionId: sub.stripeSubscriptionId },
							"Synced seat count to Stripe",
						);
					}
				}

				return seatCount;
			});

		const getCurrentSeatCount = (
			organizationId: string,
		): Effect.Effect<number, DatabaseError> =>
			Effect.tryPromise({
				try: async () => {
					const [result] = await db
						.select({ count: count() })
						.from(member)
						.where(eq(member.organizationId, organizationId));
					return result?.count ?? 0;
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to get current seat count",
						operation: "getCurrentSeatCount",
						table: "member",
						cause: error,
					}),
			});

		return SeatSyncService.of({
			syncSeatsForOrganization,

			getCurrentSeatCount,

			handleMemberAdded: (organizationId, memberId, userId) =>
				Effect.gen(function* () {
					// Get previous seat count
					const sub = yield* subscriptionService.getByOrganization(organizationId);
					const previousSeats = sub?.currentSeats ?? 0;

					// Sync seats
					const newSeats = yield* syncSeatsForOrganization(organizationId);

					// Log audit entry
					yield* Effect.tryPromise({
						try: async () => {
							await db.insert(billingSeatAudit).values({
								organizationId,
								action: "member_added",
								previousSeats,
								newSeats,
								memberId,
								userId,
								stripeReported: stripeService.config.enabled && !!sub?.stripeSubscriptionId,
							});
						},
						catch: (error) =>
							new DatabaseError({
								message: "Failed to log seat audit",
								operation: "handleMemberAdded",
								table: "billing_seat_audit",
								cause: error,
							}),
					});

					logger.info(
						{ organizationId, memberId, previousSeats, newSeats },
						"Member added, seats synced",
					);
				}),

			handleMemberRemoved: (organizationId, memberId, userId) =>
				Effect.gen(function* () {
					// Get previous seat count
					const sub = yield* subscriptionService.getByOrganization(organizationId);
					const previousSeats = sub?.currentSeats ?? 0;

					// Sync seats
					const newSeats = yield* syncSeatsForOrganization(organizationId);

					// Log audit entry
					yield* Effect.tryPromise({
						try: async () => {
							await db.insert(billingSeatAudit).values({
								organizationId,
								action: "member_removed",
								previousSeats,
								newSeats,
								memberId,
								userId,
								stripeReported: stripeService.config.enabled && !!sub?.stripeSubscriptionId,
							});
						},
						catch: (error) =>
							new DatabaseError({
								message: "Failed to log seat audit",
								operation: "handleMemberRemoved",
								table: "billing_seat_audit",
								cause: error,
							}),
					});

					logger.info(
						{ organizationId, memberId, previousSeats, newSeats },
						"Member removed, seats synced",
					);
				}),
		});
	}),
);
