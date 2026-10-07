import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BillingSeatSyncTrigger");
const BILLING_ENABLED = env.BILLING_ENABLED === "true";

/**
 * Billing and the shared runtime, imported on first use: billing stays out of the main
 * bundle, and the runtime import would otherwise close a cycle through `@/lib/auth`.
 */
async function getSeatSyncRuntime() {
	const [{ Effect }, { runtime }, { BillingServicesLive, SeatSyncService }] = await Promise.all([
		import("effect"),
		import("@/lib/effect/runtime"),
		import("@/lib/effect/services/billing"),
	]);

	return { Effect, runtime, SeatSyncService, BillingServicesLive };
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
			const { Effect, runtime, SeatSyncService, BillingServicesLive } = await getSeatSyncRuntime();
			const program = Effect.gen(function* () {
				const seatSyncService = yield* SeatSyncService;
				yield* seatSyncService.syncSeatsForOrganization(organizationId);
			});

			await runtime.runPromise(program.pipe(Effect.provide(BillingServicesLive)));
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
		const { Effect, runtime, SeatSyncService, BillingServicesLive } = await getSeatSyncRuntime();

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

		await runtime.runPromise(program.pipe(Effect.provide(BillingServicesLive)));
	} catch (error) {
		logger.error(
			{ error, organizationId },
			change === "added"
				? "Failed to sync seats after member added"
				: "Failed to sync seats after member removed",
		);
	}
}
