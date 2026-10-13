import { eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { skillReminderSetting } from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { DEFAULT_EXPIRY_REMINDER_LEAD_DAYS, expiryWindowEnd } from "@/lib/expiry-reminders/expiry";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { skillExpiryToday } from "./skill-expiry";

/**
 * The skill reminder setting (#1143): the lead time in days before a skill
 * expiry date at which the employee and their managers are reminded, and from
 * which the "Expiring soon" badge counts. Per organization, separate from the
 * personnel file reminder setting; no row means the 30-day default.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** The organization's skill reminder lead time in days (default 30). */
export async function loadSkillReminderLeadDays(
	database: Reader,
	organizationId: string,
): Promise<number> {
	const [row] = await database
		.select({ leadDays: skillReminderSetting.expiryLeadDays })
		.from(skillReminderSetting)
		.where(eq(skillReminderSetting.organizationId, organizationId))
		.limit(1);
	return row?.leadDays ?? DEFAULT_EXPIRY_REMINDER_LEAD_DAYS;
}

/** Stores a validated lead time (`validateExpiryReminderLeadDays`) for the actor's organization. */
export async function saveSkillReminderLeadDays(
	database: Database | Pick<Transaction, "insert">,
	input: { organizationId: string; leadDays: number; actorUserId?: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<void> {
	const at = dateFromInstant(now);
	await database
		.insert(skillReminderSetting)
		.values({
			organizationId: input.organizationId,
			expiryLeadDays: input.leadDays,
			updatedBy: input.actorUserId ?? null,
			updatedAt: at,
		})
		.onConflictDoUpdate({
			target: skillReminderSetting.organizationId,
			set: {
				expiryLeadDays: input.leadDays,
				updatedBy: input.actorUserId ?? null,
				updatedAt: at,
			},
		});
}

/** The organization's calendar day and skill reminder lead time, as the job and the badge see them. */
export async function loadSkillReminderWindow(
	database: Reader,
	input: { organizationId: string; now: Instant },
): Promise<{ today: string; leadDays: number; windowEnd: string }> {
	const [timezone, leadDays] = await Promise.all([
		loadOrganizationTimezone(database, input.organizationId),
		loadSkillReminderLeadDays(database, input.organizationId),
	]);
	const today = skillExpiryToday(input.now, timezone).toString();
	return { today, leadDays, windowEnd: expiryWindowEnd({ today, leadDays }) };
}
