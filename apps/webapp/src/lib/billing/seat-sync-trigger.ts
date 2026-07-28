import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSeatSyncTrigger");
const BILLING_ENABLED = env.BILLING_ENABLED === "true";

async function getSeatSyncRuntime() {
	const [{ Effect, Layer }, billingServices] = await Promise.all([
		import("effect"),
		import("@/lib/effect/services/billing"),
	]);
	const {
		SeatSyncService,
		SeatSyncServiceLive,
		StripeServiceLive,
		SubscriptionServiceLive,
	} = billingServices;
	const layers = SeatSyncServiceLive.pipe(
		Layer.provide(StripeServiceLive),
		Layer.provide(SubscriptionServiceLive),
	);

	return { Effect, SeatSyncService, layers };
}

export async function reconcileBillingSeatsForOrganization(
	organizationId: string,
	options: {
		strict?: boolean;
		run?: () => Promise<void>;
	} = {},
) {
	if (!BILLING_ENABLED) return;

	try {
		if (options.run) {
			await options.run();
		} else {
			const { Effect, SeatSyncService, layers } = await getSeatSyncRuntime();
			const program = Effect.gen(function* () {
				const seatSyncService = yield* SeatSyncService;
				yield* seatSyncService.syncSeatsForOrganization(organizationId);
			});

			await Effect.runPromise(program.pipe(Effect.provide(layers)));
		}
	} catch (error) {
		logger.error(
			{ error, organizationId },
			"Failed to reconcile billing seats",
		);
		if (options.strict) throw error;
	}
}

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
		const { Effect, SeatSyncService, layers } = await getSeatSyncRuntime();

		const program = Effect.gen(function* () {
			const seatSyncService = yield* SeatSyncService;

			if (change === "added") {
				yield* seatSyncService.handleMemberAdded(
					organizationId,
					memberId,
					userId,
				);
				return;
			}

			yield* seatSyncService.handleMemberRemoved(
				organizationId,
				memberId,
				userId,
			);
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
