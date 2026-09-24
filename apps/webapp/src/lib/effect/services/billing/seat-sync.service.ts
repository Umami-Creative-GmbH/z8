import { Context, Effect, Layer } from "effect";
import { db } from "@/db";
import { billingSeatAudit } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { DatabaseError, StripeError } from "../../errors";
import { countBillableSeats } from "./billable-seat-count";
import {
	deliverOrganizationSeats,
	SeatDeliveryUncertainError,
	type SeatStripePort,
} from "./seat-delivery";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const logger = createLogger("SeatSyncService");

function countBillableMembers(organizationId: string): Promise<number> {
	return countBillableSeats(db, organizationId);
}

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
		readonly getCurrentSeatCount: (organizationId: string) => Effect.Effect<number, DatabaseError>;
	}
>() {}

export const SeatSyncServiceLive = Layer.effect(
	SeatSyncService,
	Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;

		const stripePort: SeatStripePort = {
			getQuantity: async (subscriptionId) => {
				const stripeSubscription = await Effect.runPromise(
					stripeService.getSubscription(subscriptionId),
				);
				const item = stripeSubscription.items.data[0];
				if (!item) throw new Error("Stripe subscription has no seat item");
				return { itemId: item.id, quantity: item.quantity ?? 0 };
			},
			setQuantity: async (input) => {
				await Effect.runPromise(
					stripeService.updateSubscription(
						input.subscriptionId,
						{
							items: [{ id: input.itemId, quantity: input.quantity }],
							proration_behavior: "create_prorations",
						},
						{ idempotencyKey: input.idempotencyKey },
					),
				);
			},
		};

		/**
		 * Recomputes current billable seats and delivers them in order under the
		 * per-organization seat lock: the local count always, Stripe only when
		 * billing is enabled and a Stripe subscription exists.
		 */
		const syncSeatsForOrganization = (
			organizationId: string,
		): Effect.Effect<number, DatabaseError | StripeError> =>
			Effect.tryPromise({
				try: async () => {
					const outcome = await deliverOrganizationSeats({
						pool: db.$client,
						organizationId,
						stripe: stripeService.config.enabled ? stripePort : null,
					});
					logger.info({ organizationId, ...outcome }, "Synced billable seats");
					return outcome.seats;
				},
				catch: (error) =>
					error instanceof SeatDeliveryUncertainError
						? new StripeError({
								message: "Stripe seat delivery is uncertain and will be reconciled",
								operation: "syncSeatsForOrganization",
								cause: error,
							})
						: new DatabaseError({
								message: "Failed to sync billable seats",
								operation: "syncSeatsForOrganization",
								table: "subscription",
								cause: error,
							}),
			});

		const getCurrentSeatCount = (organizationId: string): Effect.Effect<number, DatabaseError> =>
			Effect.tryPromise({
				try: () => countBillableMembers(organizationId),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to get current billable seat count",
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
