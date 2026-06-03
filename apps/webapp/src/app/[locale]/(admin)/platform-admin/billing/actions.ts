"use server";

import { Effect, Layer } from "effect";
import { env } from "@/env";
import {
	SeatSyncService,
	SeatSyncServiceLive,
	StripeServiceLive,
	SubscriptionServiceLive,
} from "@/lib/effect/services/billing";
import {
	PlatformAdminService,
	PlatformAdminServiceLive,
} from "@/lib/effect/services/platform-admin.service";

type SyncOrganizationSeatsResult =
	| { success: true; seats: number }
	| { success: false; error: string };

export async function syncOrganizationSeatsAction(
	organizationId: string,
): Promise<SyncOrganizationSeatsResult> {
	if (env.BILLING_ENABLED !== "true") {
		return { success: false, error: "Billing is disabled" };
	}

	try {
		const billingLayers = SeatSyncServiceLive.pipe(
			Layer.provide(StripeServiceLive),
			Layer.provide(SubscriptionServiceLive),
		);
		const layers = Layer.merge(PlatformAdminServiceLive, billingLayers);

		return await Effect.runPromise(
			Effect.gen(function* () {
				const adminService = yield* PlatformAdminService;
				yield* adminService.requirePlatformAdmin();

				const seatSyncService = yield* SeatSyncService;
				const seats = yield* seatSyncService.syncSeatsForOrganization(organizationId);

				return { success: true as const, seats };
			}).pipe(
				Effect.catchTag("AuthorizationError", (error) =>
					Effect.succeed({ success: false as const, error: error.message }),
				),
				Effect.catchAll(() =>
					Effect.succeed({ success: false as const, error: "Failed to sync seats" }),
				),
				Effect.provide(layers),
			),
		);
	} catch {
		return { success: false, error: "Failed to sync seats" };
	}
}
