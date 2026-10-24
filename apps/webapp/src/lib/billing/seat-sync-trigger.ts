import { env } from "@/env";
import type { SeatSyncService } from "@/lib/effect/services/billing/seat-sync.service";
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
		/**
		 * Recount the local seats even while external billing is off, as the departure
		 * `billing_sync` task and the reconciliation job do; the seat sync then skips Stripe.
		 */
		alsoWhenBillingDisabled?: boolean;
	} = {},
) {
	if (!BILLING_ENABLED && !options.alsoWhenBillingDisabled) return;

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

/** A committed change that moves billable seats. */
export type SeatChange = "added" | "removed" | "kiosk_seat_upgraded";

/** Each seat change's seat sync handler and the message logged when it fails. */
const seatChanges = {
	added: {
		handler: "handleMemberAdded",
		failureMessage: "Failed to sync seats after member added",
	},
	removed: {
		handler: "handleMemberRemoved",
		failureMessage: "Failed to sync seats after member removed",
	},
	kiosk_seat_upgraded: {
		handler: "handleKioskSeatUpgraded",
		failureMessage: "Failed to sync seats after a kiosk seat upgrade",
	},
} as const satisfies Record<
	SeatChange,
	{
		handler: keyof Pick<
			typeof SeatSyncService.Service,
			"handleMemberAdded" | "handleMemberRemoved" | "handleKioskSeatUpgraded"
		>;
		failureMessage: string;
	}
>;

/**
 * Best-effort seat sync after a committed change: a member added or removed,
 * or a kiosk-only employee given a real email (`kiosk_seat_upgraded`, #886),
 * which moves their seat from kiosk to full. Failures are logged; uncertain
 * deliveries are reconciled by the billing seat reconciliation job.
 */
export async function syncBillingSeatsAfterMemberChange({
	organizationId,
	memberId,
	userId,
	change,
}: {
	organizationId: string;
	memberId: string;
	userId: string;
	change: SeatChange;
}) {
	if (!BILLING_ENABLED) {
		return;
	}

	try {
		const { Effect, runtime, SeatSyncService, BillingServicesLive } = await getSeatSyncRuntime();

		const program = Effect.gen(function* () {
			const seatSyncService = yield* SeatSyncService;
			yield* seatSyncService[seatChanges[change].handler](organizationId, memberId, userId);
		});

		await runtime.runPromise(program.pipe(Effect.provide(BillingServicesLive)));
	} catch (error) {
		logger.error({ error, organizationId }, seatChanges[change].failureMessage);
	}
}
