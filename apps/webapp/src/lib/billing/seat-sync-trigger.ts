import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSeatSyncTrigger");
const BILLING_ENABLED = env.BILLING_ENABLED === "true";

export async function syncBillingSeatsAfterMemberChange({
	organizationId,
	memberId,
	userId,
	change,
}: {
	organizationId: string;
	memberId: string;
	userId: string;
	change: "added" | "removed";
}) {
	if (!BILLING_ENABLED) {
		return;
	}

	try {
		const { Effect, Layer } = await import("effect");
		const { SeatSyncService, SeatSyncServiceLive, StripeServiceLive, SubscriptionServiceLive } =
			await import("@/lib/effect/services/billing");

		const layers = SeatSyncServiceLive.pipe(
			Layer.provide(StripeServiceLive),
			Layer.provide(SubscriptionServiceLive),
		);

		const program = Effect.gen(function* () {
			const seatSyncService = yield* SeatSyncService;

			if (change === "added") {
				yield* seatSyncService.handleMemberAdded(organizationId, memberId, userId);
				return;
			}

			yield* seatSyncService.handleMemberRemoved(organizationId, memberId, userId);
		});

		await Effect.runPromise(program.pipe(Effect.provide(layers)));
	} catch (error) {
		logger.error(
			{ error, organizationId },
			change === "added"
				? "Failed to sync seats after member added"
				: "Failed to sync seats after member removed",
		);
	}
}
