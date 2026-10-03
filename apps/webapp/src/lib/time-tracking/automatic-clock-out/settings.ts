import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organizationTimeTrackingSettings } from "@/db/schema/organization-time-tracking-settings";
import { type Clock, dateFromInstant } from "@/lib/datetime/temporal-core";
import {
	type WorkTransactionClient,
	withOrganizationConfigurationMutation,
} from "../work-transaction";
import {
	effectiveAutoClockOutSettings,
	parseAutoClockOutDuration,
} from "./policy";
import type { AutoClockOutSettings } from "./types";

export async function loadAutoClockOutSettings(
	tx: WorkTransactionClient,
	organizationId: string,
): Promise<AutoClockOutSettings> {
	const [stored] = await tx
		.select({
			autoClockOutEnabled: organizationTimeTrackingSettings.autoClockOutEnabled,
			maxUninterruptedMinutes:
				organizationTimeTrackingSettings.maxUninterruptedMinutes,
			revision: organizationTimeTrackingSettings.revision,
		})
		.from(organizationTimeTrackingSettings)
		.where(eq(organizationTimeTrackingSettings.organizationId, organizationId))
		.limit(1);
	return effectiveAutoClockOutSettings(stored ?? null);
}

/** The caller must verify approved owner/admin authorization before saving. */
export async function saveAutoClockOutSettings(
	input: {
		organizationId: string;
		autoClockOutEnabled: boolean;
		maxUninterruptedMinutes: number;
	},
	deps: { database: typeof db; clock: Clock },
): Promise<AutoClockOutSettings> {
	return withOrganizationConfigurationMutation(
		deps.database,
		input.organizationId,
		async (tx) => {
			const minutes = input.maxUninterruptedMinutes;
			parseAutoClockOutDuration(Math.floor(minutes / 60), minutes % 60);
			const now = dateFromInstant(deps.clock.nowInstant());
			const [stored] = await tx
				.insert(organizationTimeTrackingSettings)
				.values({
					organizationId: input.organizationId,
					autoClockOutEnabled: input.autoClockOutEnabled,
					maxUninterruptedMinutes: minutes,
					revision: 1,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: organizationTimeTrackingSettings.organizationId,
					set: {
						autoClockOutEnabled: input.autoClockOutEnabled,
						maxUninterruptedMinutes: minutes,
						revision: sql`${organizationTimeTrackingSettings.revision} + 1`,
						updatedAt: now,
					},
				})
				.returning();
			return {
				autoClockOutEnabled: stored.autoClockOutEnabled,
				maxUninterruptedMinutes: stored.maxUninterruptedMinutes,
				revision: stored.revision,
			};
		},
	);
}
