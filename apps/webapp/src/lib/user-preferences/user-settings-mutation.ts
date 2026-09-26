/**
 * The user settings writer for everything except the timezone (#312).
 *
 * Manual interpretation reads the target's settings row under the shared user
 * configuration/access guard. The row's timezone column defaults to UTC, so
 * even a first insertion made for a locale, a preference or an onboarding step
 * replaces the organization fallback with UTC. Every insert or upsert therefore
 * takes the exclusive user guard in its own transaction before writing; absent
 * rows are covered because the guard is a user key, not a row lock.
 *
 * Timezone changes go through `changeUserTimezone`, which also records the
 * balance rebuild the change requires.
 */
import type { db } from "@/db";
import { userSettings } from "@/db/schema";
import { acquireExclusiveUserConfigurationAccessGuards } from "@/lib/time-tracking/work-transaction";

type Database = Pick<typeof db, "transaction">;

export type UserSettingsValues = Omit<
	Partial<typeof userSettings.$inferInsert>,
	"id" | "userId" | "timezone" | "createdAt"
>;

export async function writeUserSettings(
	database: Database,
	userId: string,
	values: UserSettingsValues,
): Promise<void> {
	await database.transaction(async (transaction) => {
		await acquireExclusiveUserConfigurationAccessGuards(transaction, [userId]);
		await transaction
			.insert(userSettings)
			.values({ userId, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
	});
}
