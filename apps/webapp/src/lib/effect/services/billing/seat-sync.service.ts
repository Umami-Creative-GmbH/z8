import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { billingSeatAudit, subscription } from "@/db/schema";
import { DatabaseError, StripeError } from "@/lib/effect/errors";
import { type CallbackRunner, tryPromiseWithRunner } from "@/lib/effect/promise-callback";
import { countBillableSeats } from "@/lib/effect/services/billing/billable-seat-count";
import {
	deliverOrganizationSeats,
	type SeatDeliveryOutcome,
	SeatDeliveryUncertainError,
	type SeatStripePort,
} from "@/lib/effect/services/billing/seat-delivery";
import {
	findFullSeatItem,
	findKioskSeatItem,
	kioskSeatPriceFor,
	kioskSeatsEnabled,
} from "@/lib/effect/services/billing/seat-items";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { StripeService } from "./stripe.service";

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
		const dbService = yield* DatabaseService;

		const config = stripeService.config;
		const kioskSeats = kioskSeatsEnabled(config);

		/** Stripe calls for the seat delivery, run on the calling fiber through `run`. */
		const stripePortFor = (run: CallbackRunner<never>): SeatStripePort => ({
			getQuantity: async (subscriptionId) => {
				const stripeSubscription = await run(stripeService.getSubscription(subscriptionId));
				const item = findFullSeatItem(stripeSubscription, config);
				if (!item) throw new Error("Stripe subscription has no seat item");
				const full = { itemId: item.id, quantity: item.quantity ?? 0 };
				if (!kioskSeats) return full;
				const kioskItem = findKioskSeatItem(stripeSubscription, config);
				return {
					...full,
					kiosk: {
						itemId: kioskItem?.id ?? null,
						quantity: kioskItem?.quantity ?? 0,
						priceId: kioskSeatPriceFor(config, item),
					},
				};
			},
			setQuantity: async (input) => {
				const kioskItem = input.kiosk
					? input.kiosk.itemId
						? [{ id: input.kiosk.itemId, quantity: input.kiosk.quantity }]
						: [{ price: input.kiosk.priceId, quantity: input.kiosk.quantity }]
					: [];
				await run(
					stripeService.updateSubscription(
						input.subscriptionId,
						{
							items: [{ id: input.itemId, quantity: input.quantity }, ...kioskItem],
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
		 * billing is enabled and a Stripe subscription exists. Full and kiosk
		 * seats travel together while kiosk seats are on.
		 */
		const deliverSeats = (
			organizationId: string,
		): Effect.Effect<SeatDeliveryOutcome, DatabaseError | StripeError> =>
			tryPromiseWithRunner({
				try: async (run) => {
					const outcome = await deliverOrganizationSeats({
						pool: dbService.db.$client,
						organizationId,
						stripe: config.enabled ? stripePortFor(run) : null,
						kioskSeats,
					});
					logger.info({ organizationId, ...outcome }, "Synced billable seats");
					return outcome;
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

		/**
		 * Syncs seats after a membership change and audits it. "Previous" is the
		 * seat count last recorded on the subscription (total and kiosk part),
		 * read before the sync records the new one.
		 */
		const syncAndAudit = (
			action: "member_added" | "member_removed",
			organizationId: string,
			memberId: string,
			userId: string,
		): Effect.Effect<void, DatabaseError | StripeError> =>
			Effect.gen(function* () {
				const recorded = yield* dbService.query("seatSync.recordedSeats", () =>
					dbService.db.query.subscription.findFirst({
						columns: { currentSeats: true, currentKioskSeats: true, stripeSubscriptionId: true },
						where: eq(subscription.organizationId, organizationId),
					}),
				);
				const previousSeats = recorded?.currentSeats ?? 0;
				const previousKioskSeats = recorded?.currentKioskSeats ?? 0;

				const outcome = yield* deliverSeats(organizationId);
				const newSeats = outcome.seats;
				const newKioskSeats = outcome.kioskSeats ?? 0;

				yield* dbService.query(
					action === "member_added" ? "seatSync.auditMemberAdded" : "seatSync.auditMemberRemoved",
					async () => {
						await dbService.db.insert(billingSeatAudit).values({
							organizationId,
							action,
							previousSeats,
							newSeats,
							previousKioskSeats,
							newKioskSeats,
							memberId,
							userId,
							stripeReported: config.enabled && !!recorded?.stripeSubscriptionId,
						});
					},
				);

				logger.info(
					{ organizationId, memberId, previousSeats, newSeats, previousKioskSeats, newKioskSeats },
					action === "member_added" ? "Member added, seats synced" : "Member removed, seats synced",
				);
			});

		return SeatSyncService.of({
			syncSeatsForOrganization: (organizationId) =>
				Effect.map(deliverSeats(organizationId), (outcome) => outcome.seats),

			getCurrentSeatCount,

			handleMemberAdded: (organizationId, memberId, userId) =>
				syncAndAudit("member_added", organizationId, memberId, userId),

			handleMemberRemoved: (organizationId, memberId, userId) =>
				syncAndAudit("member_removed", organizationId, memberId, userId),
		});
	}),
);
