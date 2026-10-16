import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import { billingSeatDelivery, subscription } from "@/db/schema";
import type { DatabaseError } from "@/lib/effect/errors";
import { kioskSeatsEnabled } from "@/lib/effect/services/billing/seat-items";
import { SeatSyncService } from "@/lib/effect/services/billing/seat-sync.service";
import { StripeService } from "@/lib/effect/services/billing/stripe.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("KioskSeatReconcile");

/** The reconcile refused because billing or either kiosk seat price is not configured. */
export class KioskSeatsNotConfiguredError extends Data.TaggedError("KioskSeatsNotConfiguredError")<{
	message: string;
}> {}

const KIOSK_SEATS_NOT_CONFIGURED_MESSAGE =
	"Kiosk seats are not configured: set BILLING_ENABLED=true, STRIPE_PRICE_KIOSK_MONTHLY_ID and STRIPE_PRICE_KIOSK_YEARLY_ID on the webapp and the worker first. Nothing was changed.";

/**
 * One organization's result. `updated`: Stripe got a new full and kiosk seat
 * quantity (prorated); `unchanged`: Stripe already billed this split.
 */
export type KioskSeatReconciliation =
	| {
			organizationId: string;
			outcome: "updated" | "unchanged";
			fullSeats: number;
			kioskSeats: number;
	  }
	| { organizationId: string; outcome: "failed"; error: string };

function describeFailure(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause = error.cause instanceof Error ? error.cause : null;
	const root = cause?.cause instanceof Error ? cause.cause : cause;
	return root && root.message !== error.message
		? `${error.message}: ${root.message}`
		: error.message;
}

/**
 * The one-time move of existing subscriptions to kiosk seats (#886): billing
 * seat sync for every organization with a Stripe subscription (or only those
 * named), one at a time. Seat sync adds the kiosk seat item, lowers the full
 * seat quantity and lets Stripe prorate the credit. Running it again changes
 * nothing, because seat sync leaves Stripe alone when it already bills the
 * split. Refuses before any Stripe call unless billing and both kiosk seat
 * prices are configured. One organization's failure is reported and the
 * others still run.
 */
export const reconcileKioskSeats = (
	options: { organizationIds?: readonly string[] } = {},
): Effect.Effect<
	KioskSeatReconciliation[],
	KioskSeatsNotConfiguredError | DatabaseError,
	SeatSyncService | StripeService | DatabaseService
> =>
	Effect.gen(function* () {
		const { config } = yield* StripeService;
		if (!config.enabled || !kioskSeatsEnabled(config)) {
			return yield* Effect.fail(
				new KioskSeatsNotConfiguredError({ message: KIOSK_SEATS_NOT_CONFIGURED_MESSAGE }),
			);
		}
		const seatSync = yield* SeatSyncService;
		const dbService = yield* DatabaseService;

		const subscribed = yield* dbService.query("kioskSeatReconcile.subscribedOrganizations", () =>
			dbService.db
				.select({ organizationId: subscription.organizationId })
				.from(subscription)
				.where(
					and(
						isNotNull(subscription.stripeSubscriptionId),
						options.organizationIds
							? inArray(subscription.organizationId, [...options.organizationIds])
							: undefined,
					),
				)
				.orderBy(asc(subscription.organizationId)),
		);

		const deliveryGeneration = (organizationId: string) =>
			dbService.query("kioskSeatReconcile.deliveryGeneration", async () => {
				const [row] = await dbService.db
					.select({ generation: billingSeatDelivery.generation })
					.from(billingSeatDelivery)
					.where(eq(billingSeatDelivery.organizationId, organizationId));
				return row?.generation ?? 0;
			});

		const reports: KioskSeatReconciliation[] = [];
		for (const { organizationId } of subscribed) {
			const before = yield* deliveryGeneration(organizationId);
			const synced = yield* Effect.result(seatSync.syncSeatsForOrganization(organizationId));
			if (Result.isFailure(synced)) {
				logger.error({ error: synced.failure, organizationId }, "Kiosk seat reconcile failed");
				reports.push({ organizationId, outcome: "failed", error: describeFailure(synced.failure) });
				continue;
			}
			const after = yield* deliveryGeneration(organizationId);
			const seats = yield* dbService.query("kioskSeatReconcile.recordedSeats", async () => {
				const [row] = await dbService.db
					.select({
						currentSeats: subscription.currentSeats,
						currentKioskSeats: subscription.currentKioskSeats,
					})
					.from(subscription)
					.where(eq(subscription.organizationId, organizationId));
				return row;
			});
			const kioskSeats = seats?.currentKioskSeats ?? 0;
			reports.push({
				organizationId,
				outcome: after > before ? "updated" : "unchanged",
				fullSeats: (seats?.currentSeats ?? 0) - kioskSeats,
				kioskSeats,
			});
		}
		return reports;
	});

/**
 * Runs {@link reconcileKioskSeats} on the shared runtime with the billing
 * layer (deploy script entry point). Rejects with
 * {@link KioskSeatsNotConfiguredError} when kiosk seats are off.
 */
export async function reconcileKioskSeatsInEveryOrganization(
	options: { organizationIds?: readonly string[] } = {},
): Promise<KioskSeatReconciliation[]> {
	const [{ runtime }, { BillingServicesLive }] = await Promise.all([
		import("@/lib/effect/runtime"),
		import("@/lib/effect/services/billing"),
	]);
	return runtime.runPromise(reconcileKioskSeats(options).pipe(Effect.provide(BillingServicesLive)));
}
