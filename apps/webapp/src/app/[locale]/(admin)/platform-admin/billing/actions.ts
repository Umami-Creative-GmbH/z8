"use server";

import { Effect } from "effect";
import { env } from "@/env";
import { runtime } from "@/lib/effect/runtime";
import { BillingServicesLive, SeatSyncService } from "@/lib/effect/services/billing";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";

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
		return await runtime.runPromise(
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
				Effect.catch(() =>
					Effect.succeed({ success: false as const, error: "Failed to sync seats" }),
				),
				Effect.provide(BillingServicesLive),
			),
		);
	} catch {
		return { success: false, error: "Failed to sync seats" };
	}
}
