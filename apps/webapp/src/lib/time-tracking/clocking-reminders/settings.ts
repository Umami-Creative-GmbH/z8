import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organizationClockingReminderSettings } from "@/db/schema/clocking-reminder";
import { type Clock, dateFromInstant } from "@/lib/datetime/temporal-core";
import {
	type ClockingReminderGrace,
	type ClockingReminderLead,
	type ClockingReminderRole,
	type ClockingReminderSettings,
	DEFAULT_CLOCKING_REMINDER_SETTINGS,
} from "./settings-policy";

type Database = Pick<typeof db, "select" | "insert">;
type StoredSettings = typeof organizationClockingReminderSettings.$inferSelect;

export function clockingReminderSettingsFromRow(
	row: StoredSettings | null,
): ClockingReminderSettings {
	if (!row) {
		return {
			...DEFAULT_CLOCKING_REMINDER_SETTINGS,
			missedClockIn: { ...DEFAULT_CLOCKING_REMINDER_SETTINGS.missedClockIn },
			forgottenClockOut: { ...DEFAULT_CLOCKING_REMINDER_SETTINGS.forgottenClockOut },
			breakDue: { ...DEFAULT_CLOCKING_REMINDER_SETTINGS.breakDue },
			roles: [...DEFAULT_CLOCKING_REMINDER_SETTINGS.roles],
		};
	}
	return {
		missedClockIn: {
			enabled: row.missedClockInEnabled,
			graceMinutes: row.missedClockInGraceMinutes,
		},
		forgottenClockOut: {
			enabled: row.forgottenClockOutEnabled,
			graceMinutes: row.forgottenClockOutGraceMinutes,
		},
		breakDue: {
			enabled: row.breakDueEnabled,
			leadMinutes: row.breakDueLeadMinutes,
		},
		roles: row.roles,
		revision: row.revision,
	};
}

export async function loadClockingReminderSettings(
	database: Database,
	organizationId: string,
): Promise<ClockingReminderSettings> {
	const [row] = await database
		.select()
		.from(organizationClockingReminderSettings)
		.where(eq(organizationClockingReminderSettings.organizationId, organizationId))
		.limit(1);
	return clockingReminderSettingsFromRow(row ?? null);
}

/** The caller must verify approved owner/admin authorization before saving. */
export async function saveClockingReminderSettings(
	input: {
		organizationId: string;
		missedClockIn: ClockingReminderGrace;
		forgottenClockOut: ClockingReminderGrace;
		breakDue: ClockingReminderLead;
		roles: ClockingReminderRole[];
	},
	deps: { database: Database; clock: Clock },
): Promise<ClockingReminderSettings> {
	const now = dateFromInstant(deps.clock.nowInstant());
	const values = {
		missedClockInEnabled: input.missedClockIn.enabled,
		missedClockInGraceMinutes: input.missedClockIn.graceMinutes,
		forgottenClockOutEnabled: input.forgottenClockOut.enabled,
		forgottenClockOutGraceMinutes: input.forgottenClockOut.graceMinutes,
		breakDueEnabled: input.breakDue.enabled,
		breakDueLeadMinutes: input.breakDue.leadMinutes,
		roles: input.roles,
	};
	const [row] = await deps.database
		.insert(organizationClockingReminderSettings)
		.values({
			organizationId: input.organizationId,
			...values,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: organizationClockingReminderSettings.organizationId,
			set: {
				...values,
				revision: sql`${organizationClockingReminderSettings.revision} + 1`,
				updatedAt: now,
			},
		})
		.returning();
	return clockingReminderSettingsFromRow(row);
}
