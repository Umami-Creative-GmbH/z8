import { isNotNull } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { db } from "@/db";
import { subscription } from "@/db/schema";
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

export async function runBillingSeatReconciliation(): Promise<BillingSeatReconciliationResult> {
	if (env.BILLING_ENABLED !== "true") {
		return {
			success: true,
			billingEnabled: false,
			processed: 0,
			synced: 0,
			skipped: 1,
			errors: [],
		};
	}

	const subscriptions = await db.query.subscription.findMany({
		where: isNotNull(subscription.stripeSubscriptionId),
		columns: { organizationId: true },
	});
	const layers = SeatSyncServiceLive.pipe(
		Layer.provide(StripeServiceLive),
		Layer.provide(SubscriptionServiceLive),
	);
	const errors: BillingSeatReconciliationResult["errors"] = [];
	let synced = 0;

	for (const item of subscriptions) {
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const seatSyncService = yield* SeatSyncService;

					return yield* seatSyncService.syncSeatsForOrganization(item.organizationId);
				}).pipe(Effect.provide(layers)),
			);
			synced += 1;
		} catch (error) {
			logger.error(
				{ error, organizationId: item.organizationId },
				"Failed to reconcile billing seats",
			);
			errors.push({ organizationId: item.organizationId, error: getErrorMessage(error) });
		}
	}

	return {
		success: errors.length === 0,
		billingEnabled: true,
		processed: subscriptions.length,
		synced,
		skipped: 0,
		errors,
	};
}
