import { Effect, Layer } from "effect";
import { db } from "@/db";
import { env } from "@/env";
import {
	SeatSyncService,
	SeatSyncServiceLive,
	StripeServiceLive,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSeatReconciliation");

export interface BillingSeatReconciliationResult {
	success: boolean;
	billingEnabled: boolean;
	processed: number;
	synced: number;
	skipped: number;
	errors: Array<{ organizationId: string; error: string }>;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Periodic safety net for seat delivery. Every organization with a local
 * subscription is recounted and its local seat count updated, even while
 * external billing is disabled; the seat sync skips Stripe in that case and
 * reconciles any uncertain earlier delivery when enabled.
 */
export async function runBillingSeatReconciliation(): Promise<BillingSeatReconciliationResult> {
	const billingEnabled = env.BILLING_ENABLED === "true";
	const subscriptions = await db.query.subscription.findMany({
		columns: { organizationId: true },
	});
	const layers = SeatSyncServiceLive.pipe(
		Layer.provide(StripeServiceLive),
		Layer.provide(SubscriptionServiceLive),
	);
	const errors: BillingSeatReconciliationResult["errors"] = [];

	const syncResults = await Promise.all(
		subscriptions.map(async (item) => {
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const seatSyncService = yield* SeatSyncService;

					return yield* seatSyncService.syncSeatsForOrganization(item.organizationId);
				}).pipe(Effect.provide(layers)),
			);
			return { synced: true as const };
		} catch (error) {
			logger.error(
				{ error, organizationId: item.organizationId },
				"Failed to reconcile billing seats",
			);
			return {
				synced: false as const,
				error: { organizationId: item.organizationId, error: getErrorMessage(error) },
			};
		}
		}),
	);

	for (const result of syncResults) {
		if (result.synced) continue;
		errors.push(result.error);
	}

	return {
		success: errors.length === 0,
		billingEnabled,
		processed: subscriptions.length,
		synced: syncResults.filter((result) => result.synced).length,
		skipped: 0,
		errors,
	};
}
