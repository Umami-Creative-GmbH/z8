import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	runSkillExpiryReminders,
	type SkillExpiryReminderResult,
} from "@/lib/scheduling/skill-expiry-reminders";

export type SkillExpiryRemindersJobResult = SkillExpiryReminderResult;

/**
 * Sends the skill expiry reminders that are due today in each organization's
 * timezone (#1143). Sent markers make reruns and retries send nothing again.
 */
export async function runSkillExpiryRemindersJob(): Promise<SkillExpiryRemindersJobResult> {
	return runSkillExpiryReminders(db, { now: systemClock.nowInstant() });
}
