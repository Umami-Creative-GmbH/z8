import { and, asc, desc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { Effect, Result } from "effect";
import { billingSeatAudit, billingSeatDelivery, subscription } from "@/db/schema";
import { type DatabaseError, KioskSeatsNotConfiguredError } from "@/lib/effect/errors";
import { ENDED_SUBSCRIPTION_STATUSES } from "@/lib/effect/services/billing/seat-delivery";
import {
	KIOSK_SEATS_NOT_CONFIGURED_MESSAGE,
	kioskSeatReconcileConfigured,
} from "@/lib/effect/services/billing/seat-items";
import { SeatSyncService } from "@/lib/effect/services/billing/seat-sync.service";
import { StripeService } from "@/lib/effect/services/billing/stripe.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("KioskSeatReconcile");

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
 * seat sync for every organization with a Stripe subscription that has not
 * ended (or only those named), one at a time. Seat sync adds the kiosk seat
 * item, lowers the full seat quantity and lets Stripe prorate the credit; the
 * seat audit then records the new split. Running it again changes nothing,
 * because seat sync leaves Stripe alone when it already bills the split.
 * Refuses before any Stripe call unless billing and both kiosk seat prices are
 * configured. One organization's failure is reported and the others still run.
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
		if (!kioskSeatReconcileConfigured(config)) {
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
						notInArray(subscription.status, [...ENDED_SUBSCRIPTION_STATUSES]),
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
			const totalSeats = seats?.currentSeats ?? 0;
			const kioskSeats = seats?.currentKioskSeats ?? 0;
			yield* auditSplitChange(dbService, organizationId, { totalSeats, kioskSeats });
			reports.push({
				organizationId,
				outcome: after > before ? "updated" : "unchanged",
				fullSeats: totalSeats - kioskSeats,
				kioskSeats,
			});
		}
		return reports;
	});

/**
 * Brings the seat audit in line with the reconciled split: seat history (the
 * platform analytics MRR series) reads the latest audit row, which predates
 * kiosk seats. Writes a `kiosk_seat_reconciled` row only when that latest row
 * disagrees with the recorded seats; without seat history the recorded seats
 * already serve, and a second run finds the row in agreement.
 */
const auditSplitChange = (
	dbService: typeof DatabaseService.Service,
	organizationId: string,
	recorded: { totalSeats: number; kioskSeats: number },
) =>
	dbService.query("kioskSeatReconcile.auditSplit", async () => {
		const [latest] = await dbService.db
			.select({
				newSeats: billingSeatAudit.newSeats,
				newKioskSeats: billingSeatAudit.newKioskSeats,
			})
			.from(billingSeatAudit)
			.where(eq(billingSeatAudit.organizationId, organizationId))
			.orderBy(desc(billingSeatAudit.createdAt))
			.limit(1);
		if (
			!latest ||
			(latest.newSeats === recorded.totalSeats && latest.newKioskSeats === recorded.kioskSeats)
		) {
			return;
		}
		await dbService.db.insert(billingSeatAudit).values({
			organizationId,
			action: "kiosk_seat_reconciled",
			previousSeats: latest.newSeats,
			newSeats: recorded.totalSeats,
			previousKioskSeats: latest.newKioskSeats,
			newKioskSeats: recorded.kioskSeats,
			stripeReported: true,
		});
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
