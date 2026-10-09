import "server-only";

import { and, eq, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { clockingReminderOccasion, workPeriod } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

/** Occasions deleted per statement, so one run never holds a long, wide delete. */
export const CLOCKING_REMINDER_OCCASION_RETENTION_BATCH_SIZE = 1_000;

type RetentionClient = Pick<typeof rootDatabase, "select" | "selectDistinct" | "delete">;

/**
 * Deletes sent clocking reminder occasions past retention (#919), organization by organization.
 * Returns the number of rows deleted.
 *
 * An occasion row is what dedupes a reminder across channels, so it may go only once its reminder
 * can no longer be due:its expected time is more than `retentionDays` before now, and its employee has
 * no live work in the organization. A forgotten clock-out stays due for as long as the work is
 * live, however old, so every row of an employee with live work is kept until that work ends.
 * Live work is defined as in the reminders job: active, not deleted, no end and no clock-out.
 */
export async function deleteExpiredClockingReminderOccasions(
	db: RetentionClient,
	input: { now: Instant; retentionDays: number; batchSize?: number },
): Promise<number> {
	const batchSize = input.batchSize ?? CLOCKING_REMINDER_OCCASION_RETENTION_BATCH_SIZE;
	const cutoff = dateFromInstant(input.now.subtract({ hours: input.retentionDays * 24 }));
	const organizations = await db
		.selectDistinct({ organizationId: clockingReminderOccasion.organizationId })
		.from(clockingReminderOccasion)
		.where(lt(clockingReminderOccasion.expectedAt, cutoff));
	let deletedCount = 0;
	for (const { organizationId } of organizations) {
		const expired = and(
			eq(clockingReminderOccasion.organizationId, organizationId),
			lt(clockingReminderOccasion.expectedAt, cutoff),
			notExists(
				db
					.select({ one: sql`1` })
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.organizationId, organizationId),
							eq(workPeriod.employeeId, clockingReminderOccasion.employeeId),
							eq(workPeriod.isActive, true),
							isNull(workPeriod.deletedAt),
							isNull(workPeriod.endTime),
							isNull(workPeriod.clockOutId),
						),
					),
			),
		);
		for (;;) {
			const batch = db
				.select({ id: clockingReminderOccasion.id })
				.from(clockingReminderOccasion)
				.where(expired)
				.limit(batchSize);
			const deleted = await db
				.delete(clockingReminderOccasion)
				.where(and(expired, inArray(clockingReminderOccasion.id, batch)))
				.returning({ id: clockingReminderOccasion.id });
			deletedCount += deleted.length;
			if (deleted.length < batchSize) break;
		}
	}
	return deletedCount;
}
