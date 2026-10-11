import "server-only";

import type { DatabaseClient } from "@/lib/effect/services/database.service";

/**
 * Pauses the scheduled exports a user owns once an access change took their
 * org-admin rights away: a role change, a deactivation or a removal (#988).
 * Called after the change committed, with the caller's database client; it
 * never fails the change. The scheduled-exports cron runs the same check for
 * every schedule, which also covers departures that take effect by date.
 */
export async function pauseSchedulesAfterOwnerAccessChange(
	client: DatabaseClient,
	input: {
		organizationId: string;
		owner: { userId: string } | { employeeId: string };
		actorUserId: string | null;
	},
): Promise<void> {
	try {
		// Loaded on use: the settings actions that call this never load the notification senders.
		const { pauseSchedulesWithIneligibleOwners } = await import("./schedule-owner");
		const { systemClock } = await import("@/lib/datetime/temporal-core");
		await pauseSchedulesWithIneligibleOwners(client, {
			organizationId: input.organizationId,
			owner: input.owner,
			triggeredBy: input.actorUserId,
			now: systemClock.nowInstant(),
		});
	} catch (error) {
		const { createLogger } = await import("@/lib/logger");
		createLogger("ScheduledExportOwners").warn(
			{ error, organizationId: input.organizationId },
			"Pausing scheduled exports after an access change failed; the cron retries",
		);
	}
}
