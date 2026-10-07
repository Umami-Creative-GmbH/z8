import { Context, Effect, Layer } from "effect";

import { billingSeatAudit } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { DatabaseError, StripeError } from "@/lib/effect/errors";
import { type CallbackRunner, tryPromiseWithRunner } from "@/lib/effect/promise-callback";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	deliverOrganizationSeats,
	SeatDeliveryUncertainError,
	type SeatStripePort,
} from "@/lib/effect/services/billing/seat-delivery";
import { StripeService } from "./stripe.service";
import { SubscriptionService } from "./subscription.service";

const logger = createLogger("SeatSyncService");

/**
 * SeatSyncService - Real-time seat counting and Stripe usage reporting
 * Called from auth hooks when members are added/removed
 */
export class SeatSyncService extends Context.Service<
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
>()("SeatSyncService") {}

export const SeatSyncServiceLive = Layer.effect(
	SeatSyncService,
	Effect.gen(function* () {
		const stripeService = yield* StripeService;
		const subscriptionService = yield* SubscriptionService;
		const dbService = yield* DatabaseService;

		/** Stripe calls for the seat delivery, run on the calling fiber through `run`. */
		const stripePortFor = (run: CallbackRunner<never>): SeatStripePort => ({
			getQuantity: async (subscriptionId) => {
				const stripeSubscription = await run(stripeService.getSubscription(subscriptionId));
				const item = stripeSubscription.items.data[0];
				if (!item) throw new Error("Stripe subscription has no seat item");
				return { itemId: item.id, quantity: item.quantity ?? 0 };
			},
			setQuantity: async (input) => {
				await run(
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
		});

		/**
		 * Recomputes current billable seats and delivers them in order under the
		 * per-organization seat lock: the local count always, Stripe only when
		 * billing is enabled and a Stripe subscription exists.
		 */
		const syncSeatsForOrganization = (
			organizationId: string,
		): Effect.Effect<number, DatabaseError | StripeError> =>
			tryPromiseWithRunner({
				try: async (run) => {
					const outcome = await deliverOrganizationSeats({
						pool: dbService.db.$client,
						organizationId,
						stripe: stripeService.config.enabled ? stripePortFor(run) : null,
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
			dbService.query("seatSync.countBillableMembers", () =>
				countBillableSeats(dbService.db, organizationId),
			);

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
					yield* dbService.query("seatSync.auditMemberAdded", async () => {
						await dbService.db.insert(billingSeatAudit).values({
							organizationId,
							action: "member_added",
							previousSeats,
							newSeats,
							memberId,
							userId,
							stripeReported: stripeService.config.enabled && !!sub?.stripeSubscriptionId,
						});
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
					yield* dbService.query("seatSync.auditMemberRemoved", async () => {
						await dbService.db.insert(billingSeatAudit).values({
							organizationId,
							action: "member_removed",
							previousSeats,
							newSeats,
							memberId,
							userId,
							stripeReported: stripeService.config.enabled && !!sub?.stripeSubscriptionId,
						});
					});

					logger.info(
						{ organizationId, memberId, previousSeats, newSeats },
						"Member removed, seats synced",
					);
				}),
		});
	}),
);
